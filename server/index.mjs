import http from 'node:http'
import os from 'node:os'
import { resolveEngine, validateRequest, EnginePool } from './engine.mjs'
import { saveGame, listGames, getGame, deleteGame, explore, importPgn, databaseStats, clearImported } from './db.mjs'
import { masters, masterGamePgn, getToken, tokenSource, saveToken, deleteToken, LichessError } from './lichess.mjs'

const PORT = Number(process.env.SERVER_PORT ?? 3001)
// Local tool: never expose the engine or the database to the network. The Docker
// image sets SERVER_HOST=0.0.0.0 so nginx (in another container) can reach it.
const HOST = process.env.SERVER_HOST ?? '127.0.0.1'
const MAX_BODY = 1_000_000

let engine
try {
  engine = resolveEngine()
} catch (e) {
  console.warn(`[engine] ${e.message}`)
}
// One process per core, leaving room for the UI and the OS (override with ENGINE_POOL).
const POOL_SIZE = Number(process.env.ENGINE_POOL) || Math.max(1, Math.min(6, os.cpus().length - 2))
const pool = engine ? new EnginePool(engine, POOL_SIZE) : null
process.on('exit', () => pool?.close())
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0))

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const body = await readBody(req, MAX_BODY)
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    throw new Error('invalid json')
  }
}

// PGN databases (e.g. a TWIC weekly file) can be tens of MB.
const MAX_IMPORT = 200_000_000

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, engine: engine?.kind ?? null })
    }

    if (req.method === 'POST' && url.pathname === '/api/analyze') {
      if (!pool) return send(res, 503, { error: 'engine unavailable' })
      const params = validateRequest(await readJson(req))
      const job = pool.analyze(params)
      // Client aborted (position changed): stop the search immediately.
      res.on('close', () => {
        if (!res.writableEnded) job.cancel()
      })
      try {
        return send(res, 200, { lines: await job.promise })
      } catch (e) {
        if (e.message === 'cancelled') return
        throw e
      }
    }

    // Many positions at once (a whole game for the report), spread over the engine pool.
    if (req.method === 'POST' && url.pathname === '/api/analyze-batch') {
      if (!pool) return send(res, 503, { error: 'engine unavailable' })
      const body = await readJson(req)
      const items = Array.isArray(body?.items) ? body.items.slice(0, 64) : []
      const jobs = items.map((it) => {
        try {
          return pool.analyze(validateRequest(it))
        } catch (e) {
          return { promise: Promise.reject(e), cancel() {} }
        }
      })
      res.on('close', () => {
        if (!res.writableEnded) jobs.forEach((j) => j.cancel())
      })
      const settled = await Promise.allSettled(jobs.map((j) => j.promise))
      if (res.destroyed) return
      return send(res, 200, {
        results: settled.map((s) => (s.status === 'fulfilled' ? { lines: s.value } : { error: s.reason?.message ?? 'failed' })),
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/explorer') {
      return send(res, 200, explore(url.searchParams.get('fen') ?? '', url.searchParams.get('source') ?? 'user'))
    }

    // ── Lichess Masters (proxied so the token never reaches the browser) ──
    if (url.pathname === '/api/lichess-token') {
      if (req.method === 'GET') return send(res, 200, { configured: !!getToken(), source: tokenSource() })
      if (req.method === 'POST') {
        saveToken((await readJson(req)).token)
        return send(res, 200, { configured: true, source: tokenSource() })
      }
      if (req.method === 'DELETE') {
        deleteToken()
        return send(res, 200, { configured: !!getToken(), source: tokenSource() })
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/masters') {
      try {
        return send(res, 200, await masters(url.searchParams.get('fen') ?? ''))
      } catch (e) {
        if (e instanceof LichessError) return send(res, e.status, { error: e.message })
        throw e
      }
    }
    const mg = url.pathname.match(/^\/api\/masters\/pgn\/([A-Za-z0-9]+)$/)
    if (req.method === 'GET' && mg) {
      try {
        const pgn = await masterGamePgn(mg[1])
        res.writeHead(200, { 'Content-Type': 'application/x-chess-pgn' })
        return res.end(pgn)
      } catch (e) {
        if (e instanceof LichessError) return send(res, e.status, { error: e.message })
        throw e
      }
    }

    // ── Bulk PGN import (local master database) ──
    if (req.method === 'POST' && url.pathname === '/api/import') {
      return send(res, 200, importPgn(await readBody(req, MAX_IMPORT)))
    }
    if (url.pathname === '/api/database') {
      if (req.method === 'GET') return send(res, 200, databaseStats())
      if (req.method === 'DELETE') return send(res, 200, { removed: clearImported() })
    }

    if (url.pathname === '/api/games' && req.method === 'GET') {
      return send(res, 200, listGames(url.searchParams.get('q') ?? ''))
    }
    if (url.pathname === '/api/games' && req.method === 'POST') {
      return send(res, 201, { id: saveGame(await readJson(req)) })
    }
    const m = url.pathname.match(/^\/api\/games\/(\d+)$/)
    if (m && req.method === 'GET') {
      const g = getGame(Number(m[1]))
      return g ? send(res, 200, g) : send(res, 404, { error: 'not found' })
    }
    if (m && req.method === 'DELETE') {
      return deleteGame(Number(m[1])) ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' })
    }
    send(res, 404, { error: 'not found' })
  } catch (e) {
    if (!res.headersSent) send(res, 400, { error: e.message })
  }
})

server.listen(PORT, HOST, () =>
  console.log(`[server] http://${HOST}:${PORT} engine=${engine?.kind ?? 'none'} pool=${pool ? POOL_SIZE : 0}`),
)
