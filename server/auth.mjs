import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'

// Single-user login for the hosted app. Credentials live in the environment (.env):
//   AUTH_USER / AUTH_PASSWORD      → login; without AUTH_PASSWORD the API stays open (local dev)
//   RECOVERY_EMAIL + SMTP_*        → "forgot password" emails a one-time login code
// Sessions are a signed cookie (no server state); changing the password logs everyone out.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const secretFile = path.join(root, 'data', 'session-secret')

const USER = (process.env.AUTH_USER || 'admin').trim()
const PASSWORD = process.env.AUTH_PASSWORD ?? ''
const RECOVERY_EMAIL = (process.env.RECOVERY_EMAIL ?? '').trim()
const SMTP = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  user: (process.env.SMTP_USER ?? '').trim(),
  pass: (process.env.SMTP_PASS ?? '').replace(/\s+/g, ''), // Gmail shows app passwords in groups of 4
}

export const authEnabled = PASSWORD.length > 0
const recoveryEnabled = authEnabled && !!RECOVERY_EMAIL && !!SMTP.user && !!SMTP.pass

const COOKIE = 'cm_session'
const SESSION_DAYS = 30
const CODE_TTL_MS = 10 * 60_000

/** Random secret kept in the data volume, so sessions survive restarts and rebuilds. */
function loadSecret() {
  if (existsSync(secretFile)) {
    const s = readFileSync(secretFile, 'utf8').trim()
    if (s) return s
  }
  const s = randomBytes(32).toString('hex')
  mkdirSync(path.dirname(secretFile), { recursive: true })
  writeFileSync(secretFile, s, { encoding: 'utf8', mode: 0o600 })
  return s
}
const signingKey = authEnabled ? createHmac('sha256', loadSecret()).update(`${USER}\n${PASSWORD}`).digest() : null

const sign = (data) => createHmac('sha256', signingKey).update(data).digest('base64url')

/** Constant-time comparison of two strings of any length. */
const sameText = (a, b) => {
  const ha = createHash('sha256').update(String(a)).digest()
  const hb = createHash('sha256').update(String(b)).digest()
  return timingSafeEqual(ha, hb)
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** Logged-in user name, or null. */
export function sessionUser(req) {
  if (!authEnabled) return null
  const raw = readCookie(req, COOKIE)
  const [data, sig] = raw?.split('.') ?? []
  if (!data || !sig || !sameText(sig, sign(data))) return null
  try {
    const { u, exp } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    return u === USER && exp > Date.now() ? u : null
  } catch {
    return null
  }
}

export const isAuthorized = (req) => !authEnabled || sessionUser(req) !== null

// Behind Caddy → nginx the original scheme arrives in X-Forwarded-Proto.
const isHttps = (req) => (req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https'

function sessionCookie(req, value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`
}

function startSession(req, res) {
  const data = Buffer.from(JSON.stringify({ u: USER, exp: Date.now() + SESSION_DAYS * 86_400_000 })).toString('base64url')
  res.setHeader('Set-Cookie', sessionCookie(req, `${data}.${sign(data)}`, SESSION_DAYS * 86_400))
}

// ── Brute-force throttling (per client IP, in memory) ─────────────────────────
const clientIp = (req) => (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?'
const failures = new Map() // ip → { count, until }
const MAX_FAILURES = 10
const LOCK_MS = 15 * 60_000

function throttled(req) {
  const f = failures.get(clientIp(req))
  if (f && f.until < Date.now()) failures.delete(clientIp(req))
  return (failures.get(clientIp(req))?.count ?? 0) >= MAX_FAILURES
}
function recordFailure(req) {
  const ip = clientIp(req)
  const f = failures.get(ip) ?? { count: 0, until: 0 }
  failures.set(ip, { count: f.count + 1, until: Date.now() + LOCK_MS })
}

// ── Recovery code (one at a time, in memory) ──────────────────────────────────
let pending = null // { hash, expires, attempts }
let lastSent = 0
const hashCode = (code) => createHash('sha256').update(String(code)).digest('hex')

async function sendRecoveryCode() {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const transport = nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: { user: SMTP.user, pass: SMTP.pass },
  })
  await transport.sendMail({
    from: `ChessMind <${SMTP.user}>`,
    to: RECOVERY_EMAIL,
    subject: `ChessMind: código de acesso ${code}`,
    text: `Seu código de acesso ao ChessMind é ${code}.\n\nEle vale por 10 minutos e só pode ser usado uma vez.\nSe não foi você que pediu, ignore este e-mail.`,
  })
  pending = { hash: hashCode(code), expires: Date.now() + CODE_TTL_MS, attempts: 0 }
  lastSent = Date.now()
}

/** "r***i@gmail.com" — enough for the user to recognise where the code went. */
const maskEmail = (e) => e.replace(/^(.)(.*)(.@.*)$/, (_, a, mid, z) => a + '*'.repeat(Math.min(mid.length, 6)) + z)

/** Handles /api/auth/*; returns false when the path isn't an auth route. */
export async function handleAuth(req, res, url, { send, readJson }) {
  const p = url.pathname
  if (!p.startsWith('/api/auth/')) return false

  if (req.method === 'GET' && p === '/api/auth/me') {
    send(res, 200, {
      enabled: authEnabled,
      user: sessionUser(req),
      recovery: recoveryEnabled ? maskEmail(RECOVERY_EMAIL) : null,
    })
    return true
  }

  if (req.method === 'POST' && p === '/api/auth/logout') {
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0))
    send(res, 200, { ok: true })
    return true
  }

  if (!authEnabled) {
    send(res, 404, { error: 'auth disabled' })
    return true
  }
  if (throttled(req)) {
    send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos.' })
    return true
  }

  if (req.method === 'POST' && p === '/api/auth/login') {
    const { user, password } = await readJson(req)
    // Evaluate both so a wrong user name takes as long as a wrong password.
    const ok = sameText(String(user ?? '').trim(), USER) & sameText(String(password ?? ''), PASSWORD)
    if (!ok) {
      recordFailure(req)
      send(res, 401, { error: 'Usuário ou senha incorretos.' })
      return true
    }
    failures.delete(clientIp(req))
    startSession(req, res)
    send(res, 200, { user: USER })
    return true
  }

  if (req.method === 'POST' && p === '/api/auth/recover') {
    if (!recoveryEnabled) {
      send(res, 503, { error: 'Recuperação por e-mail não configurada no servidor.' })
      return true
    }
    if (Date.now() - lastSent < 60_000) {
      send(res, 429, { error: 'Um código acabou de ser enviado. Aguarde 1 minuto para pedir outro.' })
      return true
    }
    try {
      await sendRecoveryCode()
    } catch (e) {
      console.error(`[auth] failed to send recovery e-mail: ${e.message}`)
      send(res, 502, { error: 'Não foi possível enviar o e-mail. Veja os logs do servidor.' })
      return true
    }
    send(res, 200, { sentTo: maskEmail(RECOVERY_EMAIL) })
    return true
  }

  if (req.method === 'POST' && p === '/api/auth/recover/verify') {
    const { code } = await readJson(req)
    const valid = pending && pending.expires > Date.now() && sameText(hashCode(String(code ?? '').trim()), pending.hash)
    if (!valid) {
      recordFailure(req)
      if (pending && ++pending.attempts >= 5) pending = null
      send(res, 401, { error: pending ? 'Código inválido.' : 'Código inválido ou expirado. Peça um novo.' })
      return true
    }
    pending = null
    failures.delete(clientIp(req))
    startSession(req, res)
    send(res, 200, { user: USER })
    return true
  }

  send(res, 404, { error: 'not found' })
  return true
}
