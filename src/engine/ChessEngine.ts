import { Chess } from 'chess.js'
import type {
  AnalysisResult,
  Color,
  DepthSnapshot,
  EngineLineResult,
  EvalScore,
  MoveAnalysis,
} from '../types'
import {
  DEFAULT_METRICS_CONFIG,
  calculateCalculationDepth,
  calculateCriticality,
  calculateMoveQuality,
  classifyMove,
  computePositionMetrics,
  describePlayedMove,
  effectiveLoss,
  evalFromWhitePerspective,
  evalToPawns,
  isOnlyMove,
  wpFor,
  type MetricsConfig,
} from './metrics'

export {
  evalToNumber,
  formatEval,
  evalFromWhitePerspective,
  calculateMoveQuality,
  calculateCalculationDepth,
  classifyMove,
  isOnlyMove,
  criticalityTier,
  computePositionMetrics,
} from './metrics'

// ─── UCI helpers ──────────────────────────────────────────────────────────────

function parseInfoLine(line: string): Partial<EngineLineResult & { depth: number }> | null {
  if (!line.startsWith('info') || line.includes('currmove') || line.includes('lowerbound') || line.includes('upperbound')) return null
  const result: Partial<EngineLineResult & { depth: number }> = {}

  const multipv = line.match(/multipv (\d+)/)
  if (multipv) result.multipv = parseInt(multipv[1])

  const depth = line.match(/\bdepth (\d+)/)
  if (depth) result.depth = parseInt(depth[1])

  const cp = line.match(/score cp (-?\d+)/)
  if (cp) result.score = { type: 'cp', value: parseInt(cp[1]) }

  const mate = line.match(/score mate (-?\d+)/)
  if (mate) result.score = { type: 'mate', value: parseInt(mate[1]) }

  const pv = line.match(/ pv (.+)$/)
  if (pv) result.pv = pv[1].trim().split(' ')

  return result
}

export function pvToSan(fen: string, uciMoves: string[]): string[] {
  try {
    const chess = new Chess(fen)
    return uciMoves.flatMap((uci) => {
      const from = uci.slice(0, 2)
      const to = uci.slice(2, 4)
      const promotion = uci.length > 4 ? uci[4] : undefined
      const move = chess.move({ from, to, promotion })
      return move ? [move.san] : []
    })
  } catch {
    return uciMoves
  }
}

// ─── ChessEngine ─────────────────────────────────────────────────────────────


export interface AnalyzeOptions {
  depth?: number
  movetimeMs?: number
  multiPV?: number
  /** Full-width scan: every legal move, recording each move's score at every depth (for trap detection). */
  scan?: boolean
  /** Ignore a cached result shallower than this (used by infinite analysis to keep deepening). */
  minDepth?: number
}

interface Job {
  fen: string
  turn: Color
  multiPV: number
  depth: number
  movetimeMs: number
  legalMoves: number
  bestDepth: number
  lineBuffer: Map<number, EngineLineResult>
  history: DepthSnapshot[]
  /** Last fully finished iteration (all MultiPV lines at the same depth). */
  complete: { depth: number; lines: Map<number, EngineLineResult> } | null
  /** Scan mode: depth -> (first move -> score, white perspective). */
  moveScores: Map<number, Record<string, EvalScore>> | null
  /** Scan mode: depth -> (first move -> principal variation, UCI). */
  movePvs: Map<number, Record<string, string[]>> | null
  cancelled: boolean
  abort?: AbortController
  resolve: (r: AnalysisResult) => void
  reject: (e: Error) => void
}

export type EngineBackend = 'local' | 'server'

export interface AnalysisLimits {
  depth: number
  movetimeMs: number
}


export class ChessEngine {
  private worker: Worker | null = null
  private cache = new Map<string, AnalysisResult>()
  private scanCache = new Map<string, AnalysisResult>()
  private active: Job | null = null // search currently running in the worker
  private next: Job | null = null // latest request waiting for the active search to stop
  private currentMultiPV = 1
  private _isReady = false
  private readyCbs: (() => void)[] = []
  private onReadyChange?: (ready: boolean) => void
  config: MetricsConfig = { ...DEFAULT_METRICS_CONFIG }
  /** Default search caps used when a call does not pass its own. */
  limits: AnalysisLimits = { depth: 20, movetimeMs: 2500 }
  /** Full-width scans only need to reach ~depth 10 for traps to surface (≈1 s on native Stockfish). */
  scanLimits: AnalysisLimits = { depth: 11, movetimeMs: 3000 }
  backend: EngineBackend = 'local'
  onServerError?: (err: Error) => void

  constructor(onReadyChange?: (ready: boolean) => void) {
    this.onReadyChange = onReadyChange
    if (typeof window !== 'undefined') {
      // stockfish-19-asm.js is pure JavaScript (no WebAssembly); it detects the
      // Worker context via `typeof window === 'undefined'` and needs no hash URL.
      // This avoids WASM fetch/CSP issues and works in any browser environment.
      this.worker = new Worker('/stockfish-19-asm.js')
      this.worker.onmessage = (e: MessageEvent) => {
        const line = typeof e.data === 'string' ? e.data : String(e.data ?? '')
        this.handleLine(line)
      }
      this.worker.onerror = (e) => {
        console.error('Stockfish worker error:', e)
      }
      this.send('uci')
      this.send('isready')
    }
  }

  get isReady() {
    return this._isReady
  }

  setLimits(patch: Partial<AnalysisLimits>) {
    this.limits = { ...this.limits, ...patch }
  }

  setBackend(backend: EngineBackend) {
    if (backend === this.backend) return
    this.stop()
    this.backend = backend
    this.cache.clear()
    this.scanCache.clear()
  }

  setConfig(patch: Partial<MetricsConfig>) {
    this.config = { ...this.config, ...patch }
  }

  onReady(cb: () => void) {
    if (this._isReady) cb()
    else this.readyCbs.push(cb)
  }

  /** Cancels the running search and any queued request. */
  stop() {
    if (this.next) {
      this.next.reject(new Error('cancelled'))
      this.next = null
    }
    this.cancelActive()
  }

  private cancelActive() {
    if (this.active && !this.active.cancelled) {
      const job = this.active
      job.cancelled = true
      job.reject(new Error('cancelled'))
      if (job.abort) {
        // Remote search: the server kills its process when the request is aborted.
        job.abort.abort()
        this.active = null
        this.startNext()
      } else {
        this.send('stop')
      }
    }
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd)
  }

  private handleLine(line: string) {
    if (!line || typeof line !== 'string') return

    if (line === 'readyok' || line === 'uciok') {
      if (!this._isReady) {
        this._isReady = true
        this.onReadyChange?.(true)
        this.readyCbs.forEach((cb) => cb())
        this.readyCbs = []
      }
      return
    }

    const job = this.active
    if (!job) return

    if (line.startsWith('info')) {
      if (!job.cancelled) this.ingestInfo(job, line)
      return
    }

    if (line.startsWith('bestmove')) {
      this.active = null
      if (!job.cancelled) job.resolve(this.finalize(job, line))
      this.startNext()
    }
  }

  /** Folds one UCI `info` line into a job (lines, per-depth history, scan scores). */
  private ingestInfo(job: Job, line: string) {
    const parsed = parseInfoLine(line)
    if (!parsed || !parsed.score || !parsed.pv || parsed.multipv == null) return
    const depth = parsed.depth ?? 0

    const lineResult: EngineLineResult = {
      multipv: parsed.multipv,
      depth,
      score: parsed.score,
      scoreWhitePerspective: evalFromWhitePerspective(parsed.score, job.turn),
      pv: parsed.pv,
    }
    job.lineBuffer.set(parsed.multipv, lineResult)
    if (job.moveScores) {
      const level = job.moveScores.get(depth) ?? {}
      level[parsed.pv[0]] = lineResult.scoreWhitePerspective
      job.moveScores.set(depth, level)
    }
    if (job.movePvs) {
      const level = job.movePvs.get(depth) ?? {}
      level[parsed.pv[0]] = parsed.pv
      job.movePvs.set(depth, level)
    }
    if (depth > job.bestDepth) job.bestDepth = depth
    // A time-limited search can stop mid-iteration, leaving lines from two different depths
    // (even the same move twice). Only the last completed iteration is trustworthy.
    if (parsed.multipv === job.multiPV) job.complete = { depth, lines: new Map(job.lineBuffer) }

    // Record a per-depth snapshot once the 2nd MultiPV line of this depth arrives
    // (or the 1st, when there is only one legal move).
    if (parsed.multipv === Math.min(2, job.multiPV)) {
      const best = job.lineBuffer.get(1)
      if (best) {
        job.history.push({
          depth,
          bestMove: best.pv[0],
          best: best.scoreWhitePerspective,
          second: job.lineBuffer.get(2)?.scoreWhitePerspective ?? null,
        })
      }
    }
  }

  /** Builds the result at `bestmove`, caches it, and returns what the caller should get. */
  private finalize(job: Job, bestmoveLine: string): AnalysisResult {
    const bestMove = bestmoveLine.split(' ')[1] ?? ''
    const lines = job.complete?.lines ?? job.lineBuffer
    const topLines = Array.from(lines.values())
      .sort((a, b) => a.multipv - b.multipv)
      .map((l) => ({ ...l, san: pvToSan(job.fen, l.pv) }))
    const result: AnalysisResult = {
      fen: job.fen,
      depth: job.complete?.depth ?? job.bestDepth,
      multiPV: job.multiPV,
      topLines,
      bestMove,
      history: job.history,
      legalMoves: job.legalMoves,
    }
    if (job.moveScores) {
      result.moveScores = [...job.moveScores]
        .sort((a, b) => a[0] - b[0])
        .map(([depth, scores]) => ({ depth, scores, pvs: job.movePvs?.get(depth) }))
      this.scanCache.set(job.fen, result)
      return result
    }
    // Never replace a deeper analysis (e.g. from infinite mode) with a shallower one.
    const prev = this.cache.get(job.fen)
    if (prev && prev.depth > result.depth && prev.multiPV >= result.multiPV) return prev
    this.cache.set(job.fen, result)
    return result
  }

  private startNext() {
    const job = this.next
    if (!job || this.active) return
    this.next = null
    this.active = job
    if (this.backend === 'server') {
      void this.runRemote(job)
      return
    }
    if (job.multiPV !== this.currentMultiPV) {
      this.send(`setoption name MultiPV value ${job.multiPV}`)
      this.currentMultiPV = job.multiPV
    }
    this.send(`position fen ${job.fen}`)
    this.send(`go depth ${job.depth} movetime ${job.movetimeMs}`)
  }

  /** Server backend: the server returns raw UCI lines, parsed by the same code as worker output. */
  private async runRemote(job: Job) {
    job.abort = new AbortController()
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: job.fen,
          multiPV: job.multiPV,
          depth: job.depth,
          movetimeMs: job.movetimeMs,
        }),
        signal: job.abort.signal,
      })
      if (!res.ok) throw new Error(`server ${res.status}`)
      const { lines } = (await res.json()) as { lines: string[] }
      if (job.cancelled || this.active !== job) return
      for (const l of lines) this.handleLine(l)
    } catch (err) {
      if (job.cancelled) return
      job.reject(err instanceof Error ? err : new Error(String(err)))
      this.active = null
      this.onServerError?.(err instanceof Error ? err : new Error(String(err)))
      this.startNext()
    }
  }

  private terminalResult(fen: string, chess: Chess): AnalysisResult {
    // Checkmate: side to move has lost. Stalemate / insufficient material: draw.
    const score: EvalScore = chess.isCheckmate()
      ? { type: 'cp', value: -10000 }
      : { type: 'cp', value: 0 }
    const line: EngineLineResult = {
      multipv: 1,
      depth: 0,
      score,
      scoreWhitePerspective: evalFromWhitePerspective(score, chess.turn()),
      pv: [],
      san: [],
    }
    return { fen, depth: 0, multiPV: 1, topLines: [line], bestMove: '', history: [], legalMoves: 0 }
  }

  /**
   * Analyzes a position. A newer call cancels the previous one (its promise rejects
   * with Error('cancelled')). Results are cached per FEN.
   */
  analyzePosition(fen: string, opts: AnalyzeOptions = {}): Promise<AnalysisResult> {
    const hit = this.getCached(fen, opts)
    if (hit) return Promise.resolve(hit)

    const chess = new Chess(fen)
    const legalMoves = chess.moves().length
    if (legalMoves === 0) {
      const result = this.terminalResult(fen, chess)
      this.cache.set(fen, result)
      return Promise.resolve(result)
    }

    return new Promise((resolve, reject) => {
      const job = this.makeJob(fen, chess, legalMoves, opts, resolve, reject)
      if (this.next) this.next.reject(new Error('cancelled'))
      this.next = job
      const start = () => {
        if (this.active) this.cancelActive()
        else this.startNext()
      }
      if (this._isReady) start()
      else this.onReady(start)
    })
  }

  /** Cached result that satisfies `opts`, or null. */
  getCached(fen: string, opts: AnalyzeOptions = {}): AnalysisResult | null {
    if (opts.scan) return this.scanCache.get(fen) ?? null
    const cached = this.cache.get(fen)
    const multiPV = opts.multiPV ?? 5
    const deepEnough = !opts.minDepth || (cached?.depth ?? 0) >= opts.minDepth
    return cached && deepEnough && cached.multiPV >= Math.min(multiPV, Math.max(cached.legalMoves, 1)) ? cached : null
  }

  private makeJob(
    fen: string,
    chess: Chess,
    legalMoves: number,
    opts: AnalyzeOptions,
    resolve: (r: AnalysisResult) => void,
    reject: (e: Error) => void,
  ): Job {
    const multiPV = opts.multiPV ?? 5
    return {
        fen,
        turn: chess.turn(),
        multiPV: opts.scan ? legalMoves : Math.min(multiPV, legalMoves),
        depth: opts.depth ?? (opts.scan ? this.scanLimits.depth : this.limits.depth),
        movetimeMs: opts.movetimeMs ?? (opts.scan ? this.scanLimits.movetimeMs : this.limits.movetimeMs),
        legalMoves,
        bestDepth: 0,
        lineBuffer: new Map(),
        history: [],
        complete: null,
        moveScores: opts.scan ? new Map() : null,
        movePvs: opts.scan ? new Map() : null,
        cancelled: false,
        resolve,
        reject,
    }
  }

  /**
   * Analyzes many positions at once. With the server backend they run in parallel on its
   * engine pool (one request); in the browser they run one after another. Results come
   * back in input order and land in the same caches as `analyzePosition`. An `AbortSignal`
   * cancels the whole batch.
   */
  async analyzeBatch(fens: string[], opts: AnalyzeOptions = {}, signal?: AbortSignal): Promise<AnalysisResult[]> {
    const out: (AnalysisResult | null)[] = fens.map((f) => this.getCached(f, opts))
    const todo: { i: number; job: Job }[] = []
    fens.forEach((fen, i) => {
      if (out[i]) return
      const chess = new Chess(fen)
      const legal = chess.moves().length
      if (legal === 0) {
        out[i] = this.terminalResult(fen, chess)
        this.cache.set(fen, out[i]!)
        return
      }
      todo.push({ i, job: this.makeJob(fen, chess, legal, opts, () => {}, () => {}) })
    })
    if (!todo.length) return out as AnalysisResult[]

    if (this.backend !== 'server') {
      for (const { i } of todo) {
        if (signal?.aborted) throw new Error('cancelled')
        out[i] = await this.analyzePosition(fens[i], opts)
      }
      return out as AnalysisResult[]
    }

    const res = await fetch('/api/analyze-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: todo.map(({ job }) => ({ fen: job.fen, multiPV: job.multiPV, depth: job.depth, movetimeMs: job.movetimeMs })),
      }),
      signal,
    })
    if (!res.ok) throw new Error(`server ${res.status}`)
    const { results } = (await res.json()) as { results: { lines?: string[]; error?: string }[] }
    results.forEach((r, k) => {
      const { i, job } = todo[k]
      if (!r.lines) throw new Error(r.error ?? 'batch item failed')
      let best = ''
      for (const line of r.lines) {
        if (line.startsWith('info')) this.ingestInfo(job, line)
        else if (line.startsWith('bestmove')) best = line
      }
      out[i] = this.finalize(job, best)
    })
    return out as AnalysisResult[]
  }

  /** Top-N lines for a position (default 5). */
  getTopLines(fen: string, count = 5, opts: AnalyzeOptions = {}): Promise<EngineLineResult[]> {
    return this.analyzePosition(fen, { ...opts, multiPV: count }).then((r) => r.topLines.slice(0, count))
  }

  /** Full-width scan of every legal move (cached separately from regular analyses). */
  scanPosition(fen: string, opts: Omit<AnalyzeOptions, 'scan' | 'multiPV'> = {}): Promise<AnalysisResult> {
    return this.analyzePosition(fen, { ...opts, scan: true })
  }

  evaluateDifficulty(analysis: AnalysisResult, scan?: AnalysisResult | null) {
    return computePositionMetrics(analysis, this.config, scan)
  }

  /** Full analysis of a played move given the analyses of the positions before/after it. */
  buildMoveAnalysis(
    prev: AnalysisResult,
    cur: AnalysisResult,
    moveColor: Color,
    san: string,
    uci: string,
    moveNumber: number,
    scan?: AnalysisResult | null,
  ): Omit<MoveAnalysis, 'fenBefore' | 'fenAfter' | 'isAnalyzing'> {
    const bestBefore = prev.topLines[0]?.scoreWhitePerspective ?? null
    const evalAfter = cur.topLines[0]?.scoreWhitePerspective ?? null
    const metrics = computePositionMetrics(prev, this.config, scan)

    const wpBefore = bestBefore ? wpFor(bestBefore, moveColor) : 0.5
    const wpAfter = evalAfter ? wpFor(evalAfter, moveColor) : wpBefore

    // Prefer the engine's own number for the played move when it is among the top lines.
    const playedLine = prev.topLines.find((l) => l.pv[0] === uci)
    let wpLoss: number
    if (prev.bestMove === uci || prev.legalMoves <= 1) wpLoss = 0
    else if (playedLine) wpLoss = Math.max(0, wpBefore - wpFor(playedLine.scoreWhitePerspective, moveColor))
    else wpLoss = Math.max(0, wpBefore - wpAfter)

    const sign = moveColor === 'w' ? 1 : -1
    const evalDelta =
      bestBefore && evalAfter ? sign * (evalToPawns(evalAfter) - evalToPawns(bestBefore)) : 0
    const evalLoss = Math.max(0, -evalDelta)
    // Pawn loss measured like the win-probability loss: against the engine's own line for the played move when available.
    const pawnLoss =
      prev.bestMove === uci || prev.legalMoves <= 1
        ? 0
        : playedLine && bestBefore
        ? Math.max(0, sign * (evalToPawns(bestBefore) - evalToPawns(playedLine.scoreWhitePerspective)))
        : evalLoss
    const loss = effectiveLoss(wpLoss, pawnLoss, wpBefore)

    const criticality = calculateCriticality(
      prev,
      moveColor,
      wpBefore,
      wpAfter,
      describePlayedMove(prev.fen, uci),
      this.config,
      metrics.traps,
    )
    const quality = calculateMoveQuality(loss)
    const isBrilliant =
      metrics.signals.sacrifice && metrics.difficulty >= 0.6 && wpAfter >= 0.5 && wpBefore < 0.9
    const classification = classifyMove(loss, { isBrilliant, isGreat: metrics.isOnlyMove })

    return {
      moveNumber,
      color: moveColor,
      san,
      uci,
      evalBefore: bestBefore,
      evalAfter,
      topLinesBefore: prev.topLines,
      quality,
      difficulty: metrics.difficulty,
      criticality,
      isCritical: criticality > 0.75,
      stakes: metrics.criticality,
      evalDelta,
      evalLoss,
      classification,
      isOnlyMove: metrics.isOnlyMove,
      calculationDepth: metrics.calculationDepth,
      isForced: metrics.isForced,
      isSacrifice: metrics.signals.sacrifice,
      bestMoveSan: prev.topLines[0]?.san?.[0] ?? null,
      traps: metrics.traps?.traps.map((t) => t.san) ?? [],
      acceptableMoves: metrics.acceptableMoves,
      gapToSecond: metrics.gapToSecond,
      wpBefore,
      wpAfter,
      scanned: !!scan,
      analysisDepth: prev.depth,
      isAnalyzed: true,
    }
  }

  clearCache() {
    this.cache.clear()
    this.scanCache.clear()
    this.send('ucinewgame')
  }

  destroy() {
    this.stop()
    this.worker?.terminate()
    this.worker = null
  }
}
