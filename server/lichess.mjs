import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Lichess Masters explorer (~2M OTB games, 2200+). Since 2025 it requires a personal API
// token (free, no scopes). The token stays on the server: in LICHESS_TOKEN or in
// data/lichess-token.txt (git-ignored); the browser never sees it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tokenFile = path.join(root, 'data', 'lichess-token.txt')
const EXPLORER = 'https://explorer.lichess.ovh'

export function getToken() {
  if (process.env.LICHESS_TOKEN) return process.env.LICHESS_TOKEN.trim()
  return existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() || null : null
}

export const tokenSource = () => (process.env.LICHESS_TOKEN ? 'env' : existsSync(tokenFile) ? 'file' : null)

export function saveToken(token) {
  const t = String(token ?? '').trim()
  if (!/^[A-Za-z0-9_]{10,100}$/.test(t)) throw new Error('invalid token format')
  mkdirSync(path.dirname(tokenFile), { recursive: true })
  writeFileSync(tokenFile, t, { encoding: 'utf8', mode: 0o600 })
  cache.clear()
}

export function deleteToken() {
  rmSync(tokenFile, { force: true })
  cache.clear()
}

// Small LRU so navigating back and forth doesn't hit Lichess again.
const cache = new Map()
const CACHE_MAX = 500
const remember = (k, v) => {
  cache.delete(k)
  cache.set(k, v)
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  return v
}

export class LichessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

async function call(url, accept) {
  const token = getToken()
  if (!token) throw new LichessError(428, 'token-required')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept } })
  if (res.status === 401) throw new LichessError(401, 'token-rejected')
  if (res.status === 429) throw new LichessError(429, 'rate-limited')
  if (!res.ok) throw new LichessError(502, `lichess ${res.status}`)
  return res
}

/** Moves played by masters from `fen`, with results, plus the top games. */
export async function masters(fen) {
  const key = `m|${fen}`
  if (cache.has(key)) return remember(key, cache.get(key))
  const url = `${EXPLORER}/masters?fen=${encodeURIComponent(fen)}&moves=12&topGames=8`
  const data = await (await call(url, 'application/json')).json()
  return remember(key, data)
}

/** PGN of one masters game (id from `topGames`). */
export async function masterGamePgn(id) {
  if (!/^[A-Za-z0-9]{8}$/.test(id)) throw new LichessError(400, 'invalid game id')
  const key = `g|${id}`
  if (cache.has(key)) return remember(key, cache.get(key))
  const text = await (await call(`${EXPLORER}/masters/pgn/${id}`, 'application/x-chess-pgn')).text()
  return remember(key, text)
}
