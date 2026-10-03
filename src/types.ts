export type Color = 'w' | 'b'

export type MoveClassification =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder'

export interface EvalScore {
  type: 'cp' | 'mate'
  value: number // cp: centipawns (from side-to-move perspective); mate: plies (positive = current side mates)
}

export interface EngineLineResult {
  multipv: number
  depth: number
  score: EvalScore
  scoreWhitePerspective: EvalScore // normalized to white's perspective
  pv: string[] // UCI moves
  san?: string[] // SAN moves (filled in after)
}

/** Snapshot of the two leading lines at one search depth (white perspective). */
export interface DepthSnapshot {
  depth: number
  bestMove: string
  best: EvalScore
  second: EvalScore | null
}

export interface AnalysisResult {
  fen: string
  depth: number
  multiPV: number
  topLines: EngineLineResult[]
  bestMove: string
  /** Iterative-deepening history, used to estimate how deep the best move had to be calculated. */
  history: DepthSnapshot[]
  legalMoves: number
  /** Only for full-width scans (MultiPV = every legal move): score of each move per completed depth (white perspective). */
  moveScores?: { depth: number; scores: Record<string, EvalScore> }[]
}

/**
 * Moves that look fine at a glance (shallow search) but lose on deeper calculation —
 * what makes a quiet-looking position treacherous for a human.
 */
export interface TrapInfo {
  glanceDepth: number
  deepDepth: number
  legal: number
  plausible: number // moves that look fine at a glance
  traps: { uci: string; san: string; loss: number }[] // plausible moves that lose >= 10 win-probability points
  trapShare: number // traps / plausible
  goodMoves: number // moves within the acceptable window at depth
  signal: number // 0–1 contribution to criticality / difficulty
}

/** Position-level signals derived from the engine output (see engine/metrics.ts). */
export interface PositionMetrics {
  difficulty: number // 0–1 heuristic estimate, NOT a statistical probability
  criticality: number // 0–1 position stakes
  isOnlyMove: boolean
  isForced: boolean // exactly one legal move
  calculationDepth: number // plies, estimate
  acceptableMoves: number
  gapToSecond: number // win-probability points (0–1)
  signals: DifficultySignals
  traps: TrapInfo | null // null until a full-width scan is available
}

export interface DifficultySignals {
  gap: number
  narrowness: number
  avgGap: number
  depthNeed: number
  sacrifice: boolean
  quiet: boolean
  tactical: number
  forcing: number
}

export interface MoveAnalysis {
  moveNumber: number
  color: Color
  san: string
  uci: string
  fenBefore: string
  fenAfter: string

  evalBefore: EvalScore | null // from white's perspective
  evalAfter: EvalScore | null  // from white's perspective
  topLinesBefore: EngineLineResult[]

  // Derived metrics (0–1)
  quality: number
  difficulty: number
  criticality: number
  isCritical: boolean
  stakes: number // criticality of the position before the move (independent of what was played)
  evalDelta: number // pawn units, player's perspective (+good, -bad)
  evalLoss: number  // pawn units ≥ 0 (how much worse than best)

  classification: MoveClassification
  isOnlyMove: boolean
  calculationDepth: number
  isForced: boolean
  isSacrifice: boolean
  bestMoveSan: string | null
  traps: string[] // SAN of natural-looking moves that fail on deeper calculation
  acceptableMoves: number
  gapToSecond: number // win-probability points (0–1)
  wpBefore: number // mover's win probability with best play
  wpAfter: number // mover's win probability after the move

  isAnalyzed: boolean
  scanned: boolean // trap scan folded in (criticality/difficulty are final)
  analysisDepth: number // search depth behind this analysis (background passes are depth-capped)
  isAnalyzing: boolean
}

export type AppMode = 'analysis' | 'training'

export interface GameState {
  fens: string[]           // fens[i] = position after i moves
  moves: MoveAnalysis[]    // moves[i] = move that produced fens[i+1]
  currentIndex: number     // 0 = start position
  orientation: 'white' | 'black'
  mode: AppMode
  liveEval: EvalScore | null
  engineReady: boolean
  trainingReveal: boolean  // training: show best move after user move
  playerWhite: string
  playerBlack: string
}
