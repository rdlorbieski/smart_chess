import { Chess } from 'chess.js'
import type {
  AnalysisResult,
  Color,
  DifficultySignals,
  EngineLineResult,
  EvalScore,
  MoveClassification,
  PositionMetrics,
  TrapInfo,
} from '../types'

// All metrics here are heuristic estimates derived from engine output. They are
// deliberately isolated from the UI and the worker so they can later be
// calibrated with real human data (rating, time spent, hit rate, ...).

export interface MetricsConfig {
  /** Win-probability drop (0–1) to the 2nd line that makes the best move an "only move". */
  onlyMoveThreshold: number
  /** A candidate is "acceptable" when within this win-probability distance of the best line. */
  acceptableWindow: number
}

export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  onlyMoveThreshold: 0.15,
  acceptableWindow: 0.05,
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

// ─── Evaluation scales ────────────────────────────────────────────────────────

/** Pawn units for display/bars. Mate is compressed to a finite, ordered range. */
export function evalToNumber(score: EvalScore): number {
  if (score.type === 'mate') {
    const sign = score.value >= 0 ? 1 : -1
    return sign * (20 - Math.min(Math.abs(score.value), 10) * 0.1)
  }
  return Math.max(-20, Math.min(20, score.value / 100))
}

/** Pawn units clamped to ±10, used for the human-readable Δ. */
export function evalToPawns(score: EvalScore): number {
  return Math.max(-10, Math.min(10, evalToNumber(score)))
}

/** Win probability for the side the score is expressed for (Lichess logistic model). */
export function winProbability(score: EvalScore): number {
  if (score.type === 'mate') return score.value > 0 ? 1 : 0
  const cp = Math.max(-1000, Math.min(1000, score.value))
  return 0.5 + 0.5 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

export function formatEval(score: EvalScore | null, decimals = 2): string {
  if (!score) return '0.00'
  if (score.type === 'mate') return `M${score.value}`
  if (Math.abs(score.value) >= 9999) return '#'
  const v = score.value / 100
  return v > 0 ? `+${v.toFixed(decimals)}` : v.toFixed(decimals)
}

export function evalFromWhitePerspective(score: EvalScore, turn: Color): EvalScore {
  if (turn === 'w') return score
  return { type: score.type, value: -score.value }
}

/** Win probability (0–1) of the given color, from a white-perspective score. */
export function wpFor(score: EvalScore, color: Color): number {
  const wp = winProbability(score)
  return color === 'w' ? wp : 1 - wp
}

// ─── Move quality ─────────────────────────────────────────────────────────────

/** Quality 0–1 from the effective loss (win-probability points, see effectiveLoss). Piecewise-linear so it lines up with the class boundaries. */
const QUALITY_CURVE: Array<[number, number]> = [
  [0, 1], [0.01, 0.97], [0.02, 0.9], [0.05, 0.75], [0.1, 0.5], [0.2, 0.25], [0.4, 0],
]
export function calculateMoveQuality(loss: number): number {
  const l = Math.max(0, loss)
  for (let i = 1; i < QUALITY_CURVE.length; i++) {
    const [x1, y1] = QUALITY_CURVE[i]
    if (l <= x1) {
      const [x0, y0] = QUALITY_CURVE[i - 1]
      return y0 + ((y1 - y0) * (l - x0)) / (x1 - x0)
    }
  }
  return 0
}

/**
 * Win probability saturates (−1 pawn from +1.3 is only ~9 points), which made real
 * mistakes look harmless. The loss is therefore the larger of the win-probability
 * loss and a pawn-based floor (0.10 per pawn, capped) — applied only while the game
 * is still undecided, so throwing a pawn in a won/lost position is not punished.
 */
export function effectiveLoss(wpLoss: number, pawnLoss: number, wpBefore: number): number {
  const undecided = wpBefore > 0.05 && wpBefore < 0.95
  const floor = undecided ? Math.min(0.3, Math.max(0, pawnLoss) * 0.1) : 0
  return Math.max(wpLoss, floor)
}

export function classifyMove(
  loss: number,
  opts: { isBrilliant: boolean; isGreat: boolean },
): MoveClassification {
  if (loss < 0.01) {
    if (opts.isBrilliant) return 'brilliant'
    if (opts.isGreat) return 'great'
    return 'best'
  }
  if (loss < 0.02) return 'excellent'
  if (loss < 0.05) return 'good'
  if (loss < 0.1) return 'inaccuracy'
  if (loss < 0.2) return 'mistake'
  return 'blunder'
}

// ─── Position helpers ─────────────────────────────────────────────────────────

function material(chess: Chess, color: Color): number {
  let total = 0
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.color === color) total += PIECE_VALUE[sq.type]
  }
  return total
}

function playUci(chess: Chess, uci: string) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
  } catch {
    return null
  }
}

interface PvFacts {
  sacrifice: boolean
  quiet: boolean
  forcing: number // share of leading plies that are checks/captures/promotions or single replies
}

/** Replays the first plies of the best line to extract sacrifice / quietness / forcedness. */
function analyzePv(fen: string, pv: string[]): PvFacts {
  const chess = new Chess(fen)
  const mover = chess.turn()
  const startMat = material(chess, mover) - material(chess, mover === 'w' ? 'b' : 'w')
  let worstDrop = 0
  let forced = 0
  let played = 0
  let firstQuiet = false

  for (let i = 0; i < Math.min(pv.length, 6); i++) {
    const legalBefore = chess.moves().length
    const mv = playUci(chess, pv[i])
    if (!mv) break
    played++
    const isForcing =
      mv.isCapture() || !!mv.promotion || chess.inCheck() || (i % 2 === 1 && legalBefore <= 2)
    if (isForcing) forced++
    if (i === 0) firstQuiet = !mv.isCapture() && !mv.promotion && !chess.inCheck()
    if (i % 2 === 1) {
      const diff = material(chess, mover) - material(chess, mover === 'w' ? 'b' : 'w') - startMat
      worstDrop = Math.min(worstDrop, diff)
    }
  }

  return {
    sacrifice: worstDrop <= -2,
    quiet: firstQuiet,
    forcing: played ? forced / played : 0,
  }
}

/** Share of legal moves that are captures or checks — a cheap tactical-density proxy. */
function tacticalDensity(fen: string): number {
  const chess = new Chess(fen)
  const moves = chess.moves({ verbose: true })
  if (!moves.length) return 0
  const tactical = moves.filter((m) => m.isCapture() || m.san.includes('+') || m.san.includes('#'))
  return clamp01(tactical.length / 8)
}

// ─── Calculation depth ────────────────────────────────────────────────────────

/**
 * Approximate plies needed to identify the best path: the shallowest search depth
 * from which the final best move stays on top AND already shows at least half of
 * its final advantage over the 2nd line. Mating lines need 2n−1 plies to verify.
 */
export function calculateCalculationDepth(analysis: AnalysisResult, turn: Color): number {
  const top = analysis.topLines[0]
  if (!top) return 1
  if (top.score.type === 'mate' && top.score.value > 0) {
    return Math.max(1, 2 * top.score.value - 1)
  }
  const hist = analysis.history
  if (hist.length < 3) {
    return Math.max(1, Math.min(top.pv.length, analysis.depth || 1))
  }
  const final = hist[hist.length - 1]
  const finalGap = gapOf(final, turn)
  let found = final.depth
  for (let i = hist.length - 1; i >= 0; i--) {
    const h = hist[i]
    const stable = h.bestMove === final.bestMove
    const shown = finalGap < 0.03 || gapOf(h, turn) >= finalGap * 0.5
    if (!stable || !shown) break
    found = h.depth
  }
  return Math.max(1, found)
}

function gapOf(h: AnalysisResult['history'][number], turn: Color): number {
  if (!h.second) return 0
  return Math.abs(wpFor(h.best, turn) - wpFor(h.second, turn))
}

// ─── Position metrics ─────────────────────────────────────────────────────────

function wpsForMover(lines: EngineLineResult[], mover: Color): number[] {
  return lines.map((l) => wpFor(l.scoreWhitePerspective, mover))
}

export function isOnlyMove(
  analysis: AnalysisResult,
  mover: Color,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): boolean {
  if (analysis.legalMoves <= 1 || analysis.topLines.length < 2) return false
  const [best, second] = wpsForMover(analysis.topLines, mover)
  return best - second >= config.onlyMoveThreshold
}

/** Difficulty (0–1) of finding the engine's best move. Weights are easy to tune. */
export function evaluateDifficulty(
  analysis: AnalysisResult,
  mover: Color,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): { difficulty: number; signals: DifficultySignals; acceptable: number; gap: number } {
  const lines = analysis.topLines
  const empty: DifficultySignals = {
    gap: 0, narrowness: 0, avgGap: 0, depthNeed: 0,
    sacrifice: false, quiet: false, tactical: 0, forcing: 0,
  }
  if (analysis.legalMoves <= 1 || lines.length < 2) {
    return { difficulty: 0, signals: empty, acceptable: lines.length, gap: 0 }
  }

  const wps = wpsForMover(lines, mover)
  const best = wps[0]
  const gap = best - wps[1]
  const acceptable = wps.filter((w) => best - w <= config.acceptableWindow).length
  const avgGap = wps.slice(1).reduce((a, w) => a + (best - w), 0) / (wps.length - 1)
  const facts = analyzePv(analysis.fen, lines[0].pv)
  const calcDepth = calculateCalculationDepth(analysis, mover)

  const signals: DifficultySignals = {
    gap: clamp01(gap / 0.25),
    narrowness: lines.length > 1 ? 1 - (acceptable - 1) / (lines.length - 1) : 0,
    avgGap: clamp01(avgGap / 0.3),
    depthNeed: clamp01((calcDepth - 4) / 12),
    sacrifice: facts.sacrifice,
    quiet: facts.quiet,
    tactical: tacticalDensity(analysis.fen),
    forcing: facts.forcing,
  }

  // The 'human-unnatural' features only matter if the best move actually stands out.
  const standout = signals.gap
  const raw =
    0.34 * signals.gap +
    0.16 * signals.narrowness * signals.gap +
    0.14 * signals.avgGap +
    0.12 * signals.depthNeed * standout +
    0.10 * (signals.sacrifice ? 1 : 0) * standout +
    0.07 * (signals.quiet ? 1 : 0) * standout +
    0.07 * signals.tactical * standout

  // Nothing is at stake if every option keeps the same result: damp by the gap.
  return { difficulty: clamp01(raw * (0.35 + 0.65 * Math.min(1, gap / 0.08))), signals, acceptable, gap }
}

// ─── Traps (full-width scan) ──────────────────────────────────────────────────

/** "A glance": roughly what a player sees without calculating — a shallow search. */
const GLANCE_DEPTH = 4
/** A move "looks fine" at a glance when it is within this distance of the best shallow move. */
const PLAUSIBLE_WINDOW = 0.1
/** ...and is a trap when, at depth, it actually loses at least this much. */
const TRAP_LOSS = 0.1

/**
 * Compares a shallow and a deep view of EVERY legal move. Moves that look as good as the
 * best at a glance but lose on deeper calculation are traps; their share among the
 * natural-looking moves is what the top-5 lines cannot show (e.g. Carlsen–Keymer, 16.a3:
 * nine moves hold, yet a3/h3/Rhg1 look excellent until depth ~8 and then lose ~1 pawn).
 */
export function analyzeTraps(
  scan: AnalysisResult | null | undefined,
  mover: Color,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): TrapInfo | null {
  if (!scan?.moveScores?.length || scan.legalMoves < 2) return null
  const full = scan.moveScores.filter((l) => Object.keys(l.scores).length >= scan.legalMoves)
  if (!full.length) return null
  const glance = [...full].reverse().find((l) => l.depth <= GLANCE_DEPTH) ?? full[0]
  const deep = full[full.length - 1]
  // Without a real gap between the two views there is nothing to compare.
  if (deep.depth < glance.depth + 4) return null

  const lossMap = (scores: Record<string, EvalScore>) => {
    const wps = Object.entries(scores).map(([uci, s]) => [uci, wpFor(s, mover)] as const)
    const best = Math.max(...wps.map(([, w]) => w))
    return new Map(wps.map(([uci, w]) => [uci, best - w]))
  }
  const atGlance = lossMap(glance.scores)
  const atDepth = lossMap(deep.scores)

  const plausible = [...atGlance].filter(([, l]) => l < PLAUSIBLE_WINDOW).map(([uci]) => uci)
  const traps = plausible
    .filter((uci) => (atDepth.get(uci) ?? 0) >= TRAP_LOSS)
    .map((uci) => ({ uci, san: uciToSan(scan.fen, uci), loss: atDepth.get(uci) ?? 0 }))
    .sort((a, b) => b.loss - a.loss)
  const goodMoves = [...atDepth.values()].filter((l) => l <= config.acceptableWindow).length
  const trapShare = plausible.length ? traps.length / plausible.length : 0
  const meanLoss = traps.length ? traps.reduce((a, t) => a + Math.min(t.loss, 0.4), 0) / traps.length : 0

  return {
    glanceDepth: glance.depth,
    deepDepth: deep.depth,
    legal: scan.legalMoves,
    plausible: plausible.length,
    traps,
    trapShare,
    goodMoves,
    // Share alone overreacts in openings (2 of 9 natural moves failing is normal there), so
    // the signal also needs several traps before it saturates.
    signal: clamp01(trapShare / 0.4) * clamp01(traps.length / 5) * (0.6 + 0.4 * clamp01(meanLoss / 0.2)),
  }
}

function uciToSan(fen: string, uci: string): string {
  return playUci(new Chess(fen), uci)?.san ?? uci
}

/** Folds the trap signal into a 0–1 score without ever lowering it. */
const withTraps = (base: number, traps: TrapInfo | null, weight: number) =>
  traps ? clamp01(base + (1 - base) * weight * traps.signal) : base

/** Position criticality (0–1): how much the outcome depends on choosing well here. */
export function positionCriticality(
  analysis: AnalysisResult,
  mover: Color,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
): number {
  const lines = analysis.topLines
  if (analysis.legalMoves <= 1 || lines.length < 2) return 0
  const wps = wpsForMover(lines, mover)
  const best = wps[0]
  const gap = best - wps[1]
  const avgLoss = wps.slice(1).reduce((a, w) => a + (best - w), 0) / (wps.length - 1)
  const acceptable = wps.filter((w) => best - w <= config.acceptableWindow).length
  const narrowness = 1 - (acceptable - 1) / (lines.length - 1)
  // Does the choice flip the result band (winning / balanced / losing)?
  const band = (w: number) => (w >= 0.75 ? 2 : w <= 0.25 ? 0 : 1)
  const crossesBand = band(best) !== band(wps[wps.length - 1]) ? 1 : 0
  const forcing = analyzePv(analysis.fen, lines[0].pv).forcing

  return clamp01(
    0.34 * clamp01(avgLoss / 0.3) +
      0.28 * clamp01(gap / 0.25) +
      0.14 * narrowness * clamp01(avgLoss / 0.1) +
      0.14 * crossesBand +
      0.10 * forcing * clamp01(gap / 0.1),
  )
}

/** Criticality of a played move: position stakes plus the actual outcome swing. */
export function calculateCriticality(
  analysis: AnalysisResult,
  mover: Color,
  wpBefore: number,
  wpAfter: number,
  played?: { irreversible: boolean; materialSwing: number },
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
  traps: TrapInfo | null = null,
): number {
  const stakes = withTraps(positionCriticality(analysis, mover, config), traps, 0.8)
  const swing = clamp01(Math.abs(wpAfter - wpBefore) / 0.3)
  const extra = played ? (played.irreversible ? 0.04 : 0) + clamp01(Math.abs(played.materialSwing) / 5) * 0.06 : 0
  return clamp01(stakes * 0.72 + swing * 0.24 + extra)
}

export function criticalityTier(score: number): { label: string; color: string } {
  const pct = score * 100
  if (pct > 90) return { label: 'Extremamente crítico', color: '#ef4444' }
  if (pct > 75) return { label: 'Crítico', color: '#f97316' }
  if (pct > 50) return { label: 'Importante', color: '#eab308' }
  if (pct > 25) return { label: 'Relevante', color: '#86efac' }
  return { label: 'Normal', color: '#7d8590' }
}

/** Convenience: every position-level signal at once. */
export function computePositionMetrics(
  analysis: AnalysisResult,
  config: MetricsConfig = DEFAULT_METRICS_CONFIG,
  scan?: AnalysisResult | null,
): PositionMetrics {
  const mover = new Chess(analysis.fen).turn()
  const { difficulty, signals, acceptable, gap } = evaluateDifficulty(analysis, mover, config)
  const traps = analyzeTraps(scan, mover, config)
  return {
    // Traps make the right move harder to pick out, and the decision more consequential.
    difficulty: withTraps(difficulty, traps, 0.45),
    criticality: withTraps(positionCriticality(analysis, mover, config), traps, 0.8),
    traps,
    isOnlyMove: isOnlyMove(analysis, mover, config),
    isForced: analysis.legalMoves <= 1,
    calculationDepth: calculateCalculationDepth(analysis, mover),
    acceptableMoves: acceptable,
    gapToSecond: gap,
    signals,
  }
}

/** Material swing (mover's view) and irreversibility of the played move. */
export function describePlayedMove(fenBefore: string, uci: string) {
  const chess = new Chess(fenBefore)
  const mover = chess.turn()
  const other: Color = mover === 'w' ? 'b' : 'w'
  const before = material(chess, mover) - material(chess, other)
  const mv = playUci(chess, uci)
  if (!mv) return { irreversible: false, materialSwing: 0 }
  const after = material(chess, mover) - material(chess, other)
  return {
    irreversible: mv.isCapture() || mv.piece === 'p' || !!mv.promotion || mv.isKingsideCastle() || mv.isQueensideCastle(),
    materialSwing: after - before,
  }
}
