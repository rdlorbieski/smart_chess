import { spawn } from 'node:child_process'
import { chmodSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Resolves how to launch Stockfish:
 *  1. STOCKFISH_PATH (native binary).
 *  2. A native binary in `stockfish/` (Windows) or `stockfish-linux/` (Linux/macOS), auto-detected.
 *  3. Fallback: the WASM build shipped in the `stockfish` npm package, run under Node.
 */
/** Looks for a native binary in `stockfish/` (Windows) or `stockfish-linux/` (Linux/macOS). */
function findBundledBinary() {
  const isWin = process.platform === 'win32'
  const dirs = isWin ? ['stockfish'] : ['stockfish-linux', 'stockfish']
  for (const d of dirs) {
    const dir = path.join(root, d)
    if (!existsSync(dir)) continue
    const name = readdirSync(dir, { withFileTypes: true }).find(
      (f) =>
        f.isFile() &&
        /^stockfish/i.test(f.name) &&
        (isWin ? /\.exe$/i.test(f.name) : !path.extname(f.name)),
    )?.name
    if (!name) continue
    const file = path.join(dir, name)
    // Archives/checkouts often drop the executable bit.
    if (!isWin) try { chmodSync(file, 0o755) } catch { /* read-only fs: spawn will report it */ }
    return file
  }
  return null
}

export function resolveEngine() {
  const native = process.env.STOCKFISH_PATH
  if (native) {
    if (!existsSync(native)) throw new Error(`STOCKFISH_PATH not found: ${native}`)
    return { kind: 'native', command: native, args: [] }
  }
  const bin = findBundledBinary()
  if (bin) return { kind: 'native', command: bin, args: [] }
  const script = path.join(root, 'node_modules', 'stockfish', 'bin', 'stockfish-19-lite-single.js')
  if (!existsSync(script)) throw new Error('No Stockfish available: set STOCKFISH_PATH or install dependencies')
  return { kind: 'node-wasm', command: process.execPath, args: [script] }
}

const FEN_RE = /^[1-8pnbrqkPNBRQK/]+ [wb] (-|[KQkq]+) (-|[a-h][36]) \d+ \d+$/

export function validateRequest(body) {
  const fen = String(body?.fen ?? '').trim()
  if (!FEN_RE.test(fen)) throw new Error('invalid fen')
  const clamp = (v, lo, hi, d) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d
  }
  return {
    fen,
    multiPV: clamp(body.multiPV, 1, 256, 5), // full-width scans ask for every legal move
    depth: clamp(body.depth, 1, 40, 20),
    movetimeMs: clamp(body.movetimeMs, 100, 60000, 2500),
  }
}

// ── Persistent engine pool ────────────────────────────────────────────────────
// Spawning Stockfish costs ~350 ms (NNUE load) per search, and one process uses one core.
// The pool keeps N processes alive and runs searches on them concurrently, so a whole
// game can be analyzed in parallel. Each process keeps its hash table between searches.

class PooledEngine {
  constructor(engine, onIdle) {
    this.engine = engine
    this.onIdle = onIdle
    this.job = null // { req, lines, resolve, reject, cancelled }
    this.dead = false
    this.child = spawn(engine.command, engine.args, { stdio: ['pipe', 'pipe', 'ignore'] })
    this.ready = new Promise((resolve, reject) => {
      this.readyResolve = resolve
      this.child.on('error', reject)
    })
    let buf = ''
    this.child.stdout.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        this.onLine(buf.slice(0, idx).trim())
        buf = buf.slice(idx + 1)
      }
    })
    this.child.on('close', () => {
      this.dead = true
      if (this.job && !this.job.cancelled) this.job.reject(new Error('engine exited'))
      this.job = null
      this.onIdle(this)
    })
    this.send('uci')
    this.send('isready')
  }

  send(cmd) {
    if (!this.dead) this.child.stdin.write(`${cmd}\n`)
  }

  onLine(line) {
    if (line === 'readyok') return this.readyResolve()
    const job = this.job
    if (!job) return
    if (line.startsWith('info') && line.includes(' pv ') && !line.includes('bound')) {
      if (!job.cancelled) job.lines.push(line)
    } else if (line.startsWith('bestmove')) {
      this.job = null
      if (!job.cancelled) {
        job.lines.push(line)
        job.resolve(job.lines)
      }
      this.onIdle(this)
    }
  }

  get busy() {
    return this.job !== null
  }

  async run(job) {
    this.job = job
    await this.ready
    if (job.cancelled) {
      this.job = null
      return this.onIdle(this)
    }
    const { req } = job
    this.send(`setoption name MultiPV value ${req.multiPV}`)
    this.send(`position fen ${req.fen}`)
    this.send(`go depth ${req.depth} movetime ${req.movetimeMs}`)
  }

  /** Cancels the running search; the process stays alive and frees up at `bestmove`. */
  stop(job) {
    if (this.job === job) this.send('stop')
  }

  kill() {
    this.dead = true
    this.child.kill()
  }
}

export class EnginePool {
  constructor(engine, size) {
    this.engine = engine
    this.size = size
    this.workers = []
    this.queue = []
  }

  idle = (worker) => {
    if (worker.dead) this.workers = this.workers.filter((w) => w !== worker)
    this.pump()
  }

  pump() {
    while (this.queue.length) {
      let worker = this.workers.find((w) => !w.busy && !w.dead)
      if (!worker && this.workers.length < this.size) {
        worker = new PooledEngine(this.engine, this.idle)
        this.workers.push(worker)
      }
      if (!worker) return
      const job = this.queue.shift()
      if (job.cancelled) continue
      job.worker = worker
      worker.run(job)
    }
  }

  /** Same contract as `analyze()`: `{ promise, cancel }`, resolving with raw UCI lines. */
  analyze(req) {
    const job = { req, lines: [], cancelled: false, worker: null }
    const promise = new Promise((resolve, reject) => {
      job.resolve = resolve
      job.reject = reject
    })
    this.queue.push(job)
    this.pump()
    return {
      promise,
      cancel: () => {
        if (job.cancelled) return
        job.cancelled = true
        job.reject(new Error('cancelled'))
        if (job.worker) job.worker.stop(job)
        else this.queue = this.queue.filter((j) => j !== job)
      },
    }
  }

  close() {
    this.workers.forEach((w) => w.kill())
  }
}

/**
 * Runs one search in a fresh engine process and resolves with the raw UCI `info`
 * lines plus the `bestmove` line, so the client parses them exactly like worker output.
 * Calling the returned `cancel()` kills the process.
 */
export function analyze(engine, req) {
  const child = spawn(engine.command, engine.args, { stdio: ['pipe', 'pipe', 'ignore'] })
  const lines = []
  let buf = ''
  let done = false
  const promise = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', () => {
      if (!done) reject(new Error('engine exited'))
    })
    child.stdout.on('data', (chunk) => {
      buf += chunk
      let idx
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim()
        buf = buf.slice(idx + 1)
        if (line === 'uciok') {
          child.stdin.write(`setoption name MultiPV value ${req.multiPV}\n`)
          child.stdin.write(`position fen ${req.fen}\n`)
          child.stdin.write(`go depth ${req.depth} movetime ${req.movetimeMs}\n`)
        } else if (line.startsWith('info') && line.includes(' pv ') && !line.includes('bound')) {
          lines.push(line)
        } else if (line.startsWith('bestmove')) {
          done = true
          lines.push(line)
          child.stdin.write('quit\n')
          resolve(lines)
        }
      }
    })
    child.stdin.write('uci\n')
  })
  return {
    promise,
    cancel: () => {
      done = true
      child.kill()
    },
  }
}
