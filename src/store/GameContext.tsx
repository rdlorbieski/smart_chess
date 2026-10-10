import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Chess } from 'chess.js'
import { ChessEngine, type AnalysisLimits, type EngineBackend } from '../engine/ChessEngine'
import type { AppMode, Color, EngineLineResult, GameState, MoveAnalysis, PositionMetrics } from '../types'
import { STARTING_FEN, buildPgn, defaultMeta, type GameMeta } from '../lib/pgn'
import { serverHealth } from '../api/games'
import { findOpening } from '../lib/openings'
import { useChessClock, type ClockPreset, type ClockState } from './useChessClock'
import {
  addMove,
  deleteSubtree,
  isMainline,
  lineThrough,
  mainlineAncestor,
  mapMoves,
  newTree,
  parsePgn,
  promoteToMainline,
  treeToMovetext,
  updateMove,
  type Tree,
} from './gameTree'

function placeholderMove(
  partial: Pick<MoveAnalysis, 'moveNumber' | 'color' | 'san' | 'uci' | 'fenBefore' | 'fenAfter'>,
): MoveAnalysis {
  return {
    ...partial,
    evalBefore: null,
    evalAfter: null,
    topLinesBefore: [],
    quality: 0.5,
    difficulty: 0.5,
    criticality: 0.5,
    isCritical: false,
    stakes: 0,
    evalDelta: 0,
    evalLoss: 0,
    classification: 'good',
    isOnlyMove: false,
    calculationDepth: 1,
    isForced: false,
    isSacrifice: false,
    bestMoveSan: null,
    traps: [],
    acceptableMoves: 0,
    gapToSecond: 0,
    wpBefore: 0.5,
    wpAfter: 0.5,
    isAnalyzed: false,
    scanned: false,
    analysisDepth: 0,
    isAnalyzing: false,
  }
}

/** Move number from the FEN's fullmove field, so games loaded from a FEN keep real numbering. */
const fullmove = (fen: string) => parseInt(fen.split(' ')[5] ?? '1', 10) || 1

const NAV_DEBOUNCE_MS = 200
const BACKGROUND_MOVETIME_MS = 1200
/** Background positions only need depth ~16 for the report (the cursor gets the full budget). */
const BACKGROUND_DEPTH = 16
/** Positions per batch request (the server spreads them over its engine pool). */
const BATCH_SIZE = 12
/** Infinite analysis stops doubling the time budget past this (≈2.5→5→10→…→80 s steps). */
const INFINITE_MAX_MS = 120_000

/** `scanned` is false until the full-width trap scan has been folded in. */
export type LivePosition = PositionMetrics & { fen: string; lines: EngineLineResult[]; scanned: boolean }

/** Internal state: the game is a tree; the public fens/moves/currentIndex are the line through the cursor. */
interface InternalState extends Omit<GameState, 'fens' | 'moves' | 'currentIndex'> {
  tree: Tree
  rootId: string
  lineIds: string[] // root -> ... the line being viewed
  currentIndex: number // cursor = lineIds[currentIndex]
}

function initialTree(fen = STARTING_FEN) {
  const { tree, rootId } = newTree(fen)
  return { tree, rootId, lineIds: [rootId], currentIndex: 0 }
}

/** Moves the cursor to `id`, viewing the line through it. */
const focus = (tree: Tree, id: string) => {
  const lineIds = lineThrough(tree, id)
  return { lineIds, currentIndex: lineIds.indexOf(id) }
}

const epdOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

/** Main line of a freshly loaded game, with the cursor on the first position matching `fen` (else the start). */
function focusOn(tree: Tree, rootId: string, fen?: string) {
  const lineIds = lineThrough(tree, rootId)
  const idx = fen ? lineIds.findIndex((id) => epdOf(tree[id].fen) === epdOf(fen)) : -1
  return { lineIds, currentIndex: Math.max(0, idx) }
}

interface GameContextType extends GameState {
  // game tree
  tree: Tree
  rootId: string
  cursorId: string
  isOnMainline: boolean
  selectNode: (id: string) => void
  backToMainline: () => void
  promoteVariation: (id: string) => void
  deleteVariation: (id: string) => void
  makeMove: (from: string, to: string, promotion?: string) => boolean
  navigateTo: (index: number) => void
  navigateBack: () => void
  navigateForward: () => void
  navigateStart: () => void
  navigateEnd: () => void
  /** `focusFen`: open the game at the first main-line position matching it (e.g. from the explorer). */
  loadPGN: (pgn: string, opts?: { focusFen?: string }) => Promise<void>
  loadFEN: (fen: string) => void
  flipBoard: () => void
  setMode: (mode: AppMode) => void
  revealTraining: () => void
  resetGame: () => void
  retryMove: () => void
  livePosition: LivePosition | null
  showArrows: boolean
  showTrapArrows: boolean
  setShowTrapArrows: (v: boolean) => void
  setShowArrows: (v: boolean) => void
  onlyMoveThreshold: number
  setOnlyMoveThreshold: (v: number) => void
  setPlayerName: (color: 'white' | 'black', name: string) => void
  currentFen: string
  selectedMoveIndex: number | null
  setSelectedMoveIndex: (i: number | null) => void
  engine: ChessEngine
  // clock
  clock: ClockState
  configureClock: (preset: ClockPreset | null) => void
  startClock: () => void
  pauseClock: () => void
  // PGN / metadata
  meta: GameMeta
  setMeta: (patch: Partial<GameMeta>) => void
  getPgn: () => { pgn: string; result: string }
  // analysis limits / backend
  limits: AnalysisLimits
  setLimits: (patch: Partial<AnalysisLimits>) => void
  analysisPaused: boolean
  analysisBusy: boolean
  stopAnalysis: () => void
  resumeAnalysis: () => void
  serverEngine: string | null // engine kind reported by the server, null when unavailable
  backend: EngineBackend
  setBackend: (b: EngineBackend) => void
  infinite: boolean
  setInfinite: (v: boolean) => void
  liveDepth: number // depth of the live (viewed) position's analysis
}

const GameContext = createContext<GameContextType | null>(null)

export function GameProvider({ children }: { children: React.ReactNode }) {
  const engineRef = useRef<ChessEngine | null>(null)
  const [engineReady, setEngineReady] = useState(false)

  if (!engineRef.current) {
    engineRef.current = new ChessEngine((ready) => setEngineReady(ready))
  }
  const engine = engineRef.current

  const [state, setState] = useState<InternalState>({
    ...initialTree(),
    orientation: 'white',
    mode: 'analysis',
    liveEval: null,
    engineReady: false,
    trainingReveal: false,
    playerWhite: 'Brancas',
    playerBlack: 'Pretas',
  })

  const [selectedMoveIndex, setSelectedMoveIndex] = useState<number | null>(null)
  const { clock, configure: configureClock, reset: resetClock, start, pause: pauseClock, onMove } = useChessClock()
  const [meta, setMetaState] = useState<GameMeta>(defaultMeta)
  const setMeta = useCallback((patch: Partial<GameMeta>) => setMetaState((m) => ({ ...m, ...patch })), [])
  const [limits, setLimitsState] = useState<AnalysisLimits>(engine.limits)
  const [analysisPaused, setAnalysisPaused] = useState(false)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [serverEngine, setServerEngine] = useState<string | null>(null)
  const [backend, setBackendState] = useState<EngineBackend>('local')

  // Sync engine ready into state
  useEffect(() => {
    if (engineReady) setState((s) => ({ ...s, engineReady: true }))
  }, [engineReady])

  // Detect the optional backend server; if it fails mid-session, fall back to the in-browser engine.
  // A native Stockfish on the server is much faster than the browser one, so it becomes the default.
  useEffect(() => {
    serverHealth().then((h) => {
      setServerEngine(h?.ok ? (h.engine ?? null) : null)
      if (h?.ok && h.engine === 'native') {
        engine.setBackend('server')
        setBackendState('server')
        setRebuildTick((t) => t + 1)
      }
    })
    engine.onServerError = () => {
      engine.setBackend('local')
      setBackendState('local')
      setServerEngine(null)
    }
  }, [engine])

  const setBackend = useCallback(
    (b: EngineBackend) => {
      engine.setBackend(b)
      setBackendState(b)
      setRebuildTick((t) => t + 1)
    },
    [engine],
  )

  const setLimits = useCallback(
    (patch: Partial<AnalysisLimits>) => {
      engine.setLimits(patch)
      setLimitsState(engine.limits)
    },
    [engine],
  )

  // ── Analysis loop ────────────────────────────────────────────────────────
  // The visited position is analyzed first (full time budget), then the rest of the
  // game is filled in the background. Any navigation/new move restarts the loop
  // after a short debounce; the engine cancels whatever search was running.
  const stateRef = useRef(state)
  stateRef.current = state
  const runToken = useRef(0)
  const [rebuildTick, setRebuildTick] = useState(0)
  const [showArrows, setShowArrows] = useState(true)
  const [showTrapArrows, setShowTrapArrows] = useState(true)
  const [livePosition, setLivePosition] = useState<LivePosition | null>(null)
  const [onlyMoveThreshold, setOnlyMoveThresholdState] = useState(engine.config.onlyMoveThreshold)

  const setOnlyMoveThreshold = useCallback(
    (v: number) => {
      engine.setConfig({ onlyMoveThreshold: v })
      setOnlyMoveThresholdState(v)
      // Metrics depend on the threshold: mark analyzed moves stale so they are rebuilt from cached engine output.
      setState((s) => ({ ...s, tree: mapMoves(s.tree, (m) => ({ ...m, isAnalyzed: false, scanned: false })) }))
      setRebuildTick((t) => t + 1)
    },
    [engine],
  )

  const analyzeMoveAt = useCallback(
    async (ply: number, token: number, movetimeMs?: number) => {
      const s = stateRef.current
      const nodeId = s.lineIds[ply]
      const node = nodeId ? s.tree[nodeId] : undefined
      const move = node?.move
      // The move being looked at gets the full budget, even if a (depth-capped) background
      // pass already analyzed it; background moves (movetimeMs given) accept any analysis.
      const full = movetimeMs === undefined
      if (!node || !move) return
      if (move.isAnalyzed && move.scanned && (!full || move.analysisDepth > BACKGROUND_DEPTH)) return
      const fenBefore = s.tree[node.parentId!].fen
      const fenAfter = node.fen
      const minDepth = full ? BACKGROUND_DEPTH + 1 : undefined
      const prev = await engine.analyzePosition(fenBefore, { movetimeMs, minDepth })
      if (token !== runToken.current) return
      const cur = await engine.analyzePosition(fenAfter, { movetimeMs, minDepth })
      if (token !== runToken.current) return
      const scan = await engine.scanPosition(fenBefore, movetimeMs ? { movetimeMs: Math.min(movetimeMs, engine.scanLimits.movetimeMs) } : {})
      if (token !== runToken.current) return
      const built = engine.buildMoveAnalysis(prev, cur, move.color, move.san, move.uci, move.moveNumber, scan)
      // Analyses live on the node, so they survive switching lines or reordering variations.
      setState((st) => ({ ...st, tree: updateMove(st.tree, nodeId, { ...built, fenBefore, fenAfter, isAnalyzing: false }) }))
    },
    [engine],
  )

  /** Builds analyses for every move of the viewed line whose positions are already cached. */
  const buildCachedMoves = useCallback(() => {
    setState((st) => {
      let tree = st.tree
      for (const id of st.lineIds.slice(1)) {
        const node = tree[id]
        const move = node.move!
        if (move.isAnalyzed && move.scanned) continue
        const fenBefore = tree[node.parentId!].fen
        const prev = engine.getCached(fenBefore)
        const cur = engine.getCached(node.fen)
        if (!prev || !cur) continue
        const scan = engine.getCached(fenBefore, { scan: true })
        if (move.isAnalyzed && !scan) continue // nothing new to add yet
        const built = engine.buildMoveAnalysis(prev, cur, move.color, move.san, move.uci, move.moveNumber, scan)
        tree = updateMove(tree, id, { ...built, fenBefore, fenAfter: node.fen, isAnalyzing: false })
      }
      return tree === st.tree ? st : { ...st, tree }
    })
  }, [engine])

  const analyzeLineInBatches = useCallback(
    async (token: number, cursor: number) => {
      const s = stateRef.current
      const fensOfLine = s.lineIds.map((id) => s.tree[id].fen)
      const byDistance = (a: number, b: number) => Math.abs(a - cursor) - Math.abs(b - cursor)
      const opts = { movetimeMs: Math.min(BACKGROUND_MOVETIME_MS, engine.limits.movetimeMs), depth: BACKGROUND_DEPTH }

      // Pass 1: evaluations.
      const evalIdx = fensOfLine.map((_, i) => i).filter((i) => !engine.getCached(fensOfLine[i])).sort(byDistance)
      for (let k = 0; k < evalIdx.length; k += BATCH_SIZE) {
        if (token !== runToken.current) return
        await engine.analyzeBatch(evalIdx.slice(k, k + BATCH_SIZE).map((i) => fensOfLine[i]), opts)
        if (token !== runToken.current) return
        buildCachedMoves()
      }
      buildCachedMoves()

      // Pass 2: trap scans of the position before each move.
      const scanIdx = fensOfLine
        .slice(0, -1)
        .map((_, i) => i)
        .filter((i) => !engine.getCached(fensOfLine[i], { scan: true }))
        .sort(byDistance)
      const scanOpts = { scan: true, movetimeMs: Math.min(1500, engine.scanLimits.movetimeMs) }
      for (let k = 0; k < scanIdx.length; k += BATCH_SIZE) {
        if (token !== runToken.current) return
        await engine.analyzeBatch(scanIdx.slice(k, k + BATCH_SIZE).map((i) => fensOfLine[i]), scanOpts)
        if (token !== runToken.current) return
        buildCachedMoves()
      }
    },
    [engine, buildCachedMoves],
  )

  // Infinite analysis toggle (ref so the running loop sees changes without restarting).
  const [infinite, setInfiniteState] = useState(false)
  const infiniteRef = useRef(false)
  const setInfinite = useCallback((v: boolean) => {
    infiniteRef.current = v
    setInfiniteState(v)
  }, [])
  const [liveDepth, setLiveDepth] = useState(0)

  const stopAnalysis = useCallback(() => {
    runToken.current++
    engine.stop()
    setAnalysisPaused(true)
    setAnalysisBusy(false)
  }, [engine])
  const resumeAnalysis = useCallback(() => setAnalysisPaused(false), [])

  const fensKey = state.lineIds.join(',') + ':' + state.currentIndex
  useEffect(() => {
    if (!engineReady || analysisPaused) return
    const token = ++runToken.current
    const timer = setTimeout(async () => {
      const s0 = stateRef.current
      setAnalysisBusy(true)
      try {
        const liveFen = s0.tree[s0.lineIds[s0.currentIndex]].fen
        const curResult = await engine.analyzePosition(liveFen)
        if (token !== runToken.current) return
        setState((s) => ({ ...s, liveEval: curResult.topLines[0]?.scoreWhitePerspective ?? null }))
        setLiveDepth(curResult.depth)
        setLivePosition({ ...engine.evaluateDifficulty(curResult), fen: liveFen, lines: curResult.topLines, scanned: false })
        // Second pass: scan every legal move so hidden traps count toward criticality/difficulty.
        const liveScan = await engine.scanPosition(liveFen)
        if (token !== runToken.current) return
        setLivePosition({ ...engine.evaluateDifficulty(curResult, liveScan), fen: liveFen, lines: curResult.topLines, scanned: true })

        if (s0.currentIndex > 0) {
          const curId = s0.lineIds[s0.currentIndex]
          setState((s) => (s.tree[curId]?.move?.isAnalyzed ? s : { ...s, tree: updateMove(s.tree, curId, { isAnalyzing: true }) }))
          await analyzeMoveAt(s0.currentIndex, token)
        }

        // Background passes over the rest of the line, closest to the cursor first, in batches
        // (parallel on the server's engine pool):
        //   1) evaluate every position (depth-capped) -> every move gets quality / report data;
        //   2) trap scans of the positions before each move -> final criticality / difficulty.
        await analyzeLineInBatches(token, s0.currentIndex)

        // Infinite analysis: keep deepening the viewed position, doubling the time budget each
        // step, and publish every deeper result (eval bar, arrows, metrics, depth counter).
        let best = curResult
        let budget = engine.limits.movetimeMs
        while (infiniteRef.current && token === runToken.current && budget < INFINITE_MAX_MS) {
          budget *= 2
          const deeper = await engine.analyzePosition(liveFen, { movetimeMs: budget, depth: 99, minDepth: best.depth + 1 })
          if (token !== runToken.current) return
          if (deeper.depth <= best.depth) continue
          best = deeper
          setState((s) => ({ ...s, liveEval: best.topLines[0]?.scoreWhitePerspective ?? null }))
          setLivePosition({ ...engine.evaluateDifficulty(best, liveScan), fen: liveFen, lines: best.topLines, scanned: true })
          setLiveDepth(best.depth)
        }
      } catch {
        // cancelled by a newer request
      } finally {
        if (token === runToken.current) setAnalysisBusy(false)
      }
    }, NAV_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fensKey, rebuildTick, engineReady, analysisPaused, infinite, engine, analyzeMoveAt, analyzeLineInBatches])

  // ── Actions ──────────────────────────────────────────────────────────────

  const makeMove = useCallback(
    (from: string, to: string, promotion = 'q'): boolean => {
      const s = stateRef.current
      const fenBefore = s.tree[s.lineIds[s.currentIndex]].fen
      const chess = new Chess(fenBefore)
      let result
      try {
        result = chess.move({ from, to, promotion })
      } catch {
        return false
      }
      if (!result) return false

      const newFen = chess.fen()
      const color = result.color as Color
      const newMove = placeholderMove({
        moveNumber: fullmove(fenBefore),
        color,
        san: result.san,
        uci: from + to + (result.promotion ?? ''),
        fenBefore,
        fenAfter: newFen,
      })

      // Playing a move never discards the game: it follows an existing child or opens a variation.
      setState((st) => {
        const added = addMove(st.tree, st.lineIds[st.currentIndex], newMove, newFen)
        return { ...st, tree: added.tree, ...focus(added.tree, added.id), trainingReveal: false }
      })
      onMove(color, chess.isGameOver())
      return true
    },
    [onMove],
  )

  const navigateTo = useCallback((index: number) => {
    setState((s) => {
      const clamped = Math.max(0, Math.min(index, s.lineIds.length - 1))
      if (clamped === s.currentIndex) return s
      return { ...s, currentIndex: clamped, trainingReveal: false }
    })
  }, [])

  const navigateBack = useCallback(() => {
    setState((s) => ({ ...s, currentIndex: Math.max(0, s.currentIndex - 1), trainingReveal: false }))
  }, [])
  const navigateForward = useCallback(() => {
    setState((s) => ({ ...s, currentIndex: Math.min(s.lineIds.length - 1, s.currentIndex + 1), trainingReveal: false }))
  }, [])
  const navigateStart = useCallback(() => navigateTo(0), [navigateTo])
  const navigateEnd = useCallback(() => {
    setState((s) => ({ ...s, currentIndex: s.lineIds.length - 1, trainingReveal: false }))
  }, [])

  const loadPGN = useCallback(async (pgn: string, opts?: { focusFen?: string }) => {
    try {
      // Own parser: keeps variations, comments and NAGs (chess.js would keep only the main line).
      const { tree, rootId, headers } = parsePgn(pgn, (p) =>
        placeholderMove({ ...p, moveNumber: fullmove(p.fenBefore) }),
      )
      if (!tree[rootId].children.length && !headers.FEN) throw new Error('no moves found')

      engine.clearCache()
      resetClock()
      const known = (v?: string) => (v && !/^[?.\s-]*$/.test(v) ? v : '')
      setMetaState({
        event: known(headers.Event),
        site: known(headers.Site),
        date: known(headers.Date) || defaultMeta().date,
        round: known(headers.Round),
      })
      setState((s) => ({
        ...s,
        playerWhite: known(headers.White) || s.playerWhite,
        playerBlack: known(headers.Black) || s.playerBlack,
        tree,
        rootId,
        ...focusOn(tree, rootId, opts?.focusFen),
        liveEval: null,
        trainingReveal: false,
      }))
      setSelectedMoveIndex(null)
    } catch (err) {
      console.error('PGN parse error', err)
    }
  }, [engine, resetClock])

  const loadFEN = useCallback((fen: string) => {
    try {
      new Chess(fen) // validate
      engine.clearCache()
      resetClock()
      setState((s) => ({
        ...s,
        ...initialTree(new Chess(fen).fen()),
        liveEval: null,
        trainingReveal: false,
      }))
      setSelectedMoveIndex(null)
    } catch {
      console.error('Invalid FEN')
    }
  }, [engine, resetClock])

  const flipBoard = useCallback(() => {
    setState((s) => ({ ...s, orientation: s.orientation === 'white' ? 'black' : 'white' }))
  }, [])

  const setMode = useCallback((mode: AppMode) => {
    setState((s) => ({ ...s, mode }))
  }, [])

  const revealTraining = useCallback(() => {
    setState((s) => ({ ...s, trainingReveal: true }))
  }, [])

  const setPlayerName = useCallback((color: 'white' | 'black', name: string) => {
    if (color === 'white') setState((s) => ({ ...s, playerWhite: name.trim() || 'Brancas' }))
    else setState((s) => ({ ...s, playerBlack: name.trim() || 'Pretas' }))
  }, [])

  const resetGame = useCallback(() => {
    engine.clearCache()
    resetClock()
    setMetaState(defaultMeta())
    setState((s) => ({
      ...initialTree(),
      orientation: 'white',
      mode: 'analysis',
      liveEval: null,
      engineReady,
      trainingReveal: false,
      playerWhite: s.playerWhite,
      playerBlack: s.playerBlack,
    }))
    setSelectedMoveIndex(null)
  }, [engine, engineReady, resetClock])

  const retryMove = useCallback(() => {
    setState((s) => {
      if (s.currentIndex === 0) return s
      const id = s.lineIds[s.currentIndex]
      const parentId = s.tree[id].parentId!
      // Coach "try again": forget the attempt (only if nothing was played after it).
      const tree = s.tree[id].children.length ? s.tree : deleteSubtree(s.tree, id)
      return { ...s, tree, ...focus(tree, parentId), trainingReveal: false }
    })
  }, [])

  const getPgn = useCallback(() => {
    // Headers/result/opening come from the main line; the movetext carries every variation.
    const mainFens = lineThrough(state.tree, state.rootId).map((id) => state.tree[id].fen)
    return buildPgn({
      mainlineFens: mainFens,
      movetext: treeToMovetext(state.tree, state.rootId),
      white: state.playerWhite,
      black: state.playerBlack,
      meta,
      flagged: clock.flagged,
      opening: findOpening(mainFens, mainFens.length - 1),
    })
  }, [state.tree, state.rootId, state.playerWhite, state.playerBlack, meta, clock.flagged])

  // -- Tree navigation --------------------------------------------------------
  const selectNode = useCallback((id: string) => {
    setState((s) => (s.tree[id] ? { ...s, ...focus(s.tree, id), trainingReveal: false } : s))
  }, [])

  /** Back to where the current variation left the main line, now viewing the main line. */
  const backToMainline = useCallback(() => {
    setState((s) => {
      const anchor = mainlineAncestor(s.tree, s.lineIds[s.currentIndex])
      return { ...s, ...focus(s.tree, anchor), trainingReveal: false }
    })
  }, [])

  const promoteVariation = useCallback((id: string) => {
    setState((s) => {
      if (!s.tree[id]) return s
      const tree = promoteToMainline(s.tree, id)
      return { ...s, tree, ...focus(tree, s.lineIds[s.currentIndex]) }
    })
  }, [])

  const deleteVariation = useCallback((id: string) => {
    setState((s) => {
      const node = s.tree[id]
      if (!node?.parentId) return s
      const tree = deleteSubtree(s.tree, id)
      // If the cursor was inside the deleted branch, land on the branch point.
      const cursor = s.lineIds[s.currentIndex]
      return { ...s, tree, ...focus(tree, tree[cursor] ? cursor : node.parentId) }
    })
  }, [])

  const startClock = useCallback(() => {
    const s = stateRef.current
    start(new Chess(s.tree[s.lineIds[s.lineIds.length - 1]].fen).turn())
  }, [start])

  // Public, list-shaped view of the line being viewed (what the components consume).
  const fens = useMemo(() => state.lineIds.map((id) => state.tree[id].fen), [state.lineIds, state.tree])
  const moves = useMemo(() => state.lineIds.slice(1).map((id) => state.tree[id].move!), [state.lineIds, state.tree])
  const cursorId = state.lineIds[state.currentIndex]
  const currentFen = fens[state.currentIndex] ?? STARTING_FEN
  const isOnMainline = isMainline(state.tree, cursorId)

  const value = useMemo<GameContextType>(
    () => ({
      ...state,
      fens,
      moves,
      cursorId,
      isOnMainline,
      selectNode,
      backToMainline,
      promoteVariation,
      deleteVariation,
      engineReady,
      makeMove,
      navigateTo,
      navigateBack,
      navigateForward,
      navigateStart,
      navigateEnd,
      loadPGN,
      loadFEN,
      flipBoard,
      setMode,
      revealTraining,
      resetGame,
      retryMove,
      livePosition,
      showArrows,
      setShowArrows,
      showTrapArrows,
      setShowTrapArrows,
      onlyMoveThreshold,
      setOnlyMoveThreshold,
      setPlayerName,
      currentFen,
      selectedMoveIndex,
      setSelectedMoveIndex,
      engine,
      clock,
      configureClock,
      startClock,
      pauseClock,
      meta,
      setMeta,
      getPgn,
      limits,
      setLimits,
      analysisPaused,
      analysisBusy,
      stopAnalysis,
      resumeAnalysis,
      serverEngine,
      backend,
      setBackend,
      infinite,
      setInfinite,
      liveDepth,
    }),
    [
      state,
      fens,
      moves,
      cursorId,
      isOnMainline,
      selectNode,
      backToMainline,
      promoteVariation,
      deleteVariation,
      engineReady,
      makeMove,
      navigateTo,
      navigateBack,
      navigateForward,
      navigateStart,
      navigateEnd,
      loadPGN,
      loadFEN,
      flipBoard,
      setMode,
      revealTraining,
      resetGame,
      retryMove,
      livePosition,
      showArrows,
      showTrapArrows,
      onlyMoveThreshold,
      setOnlyMoveThreshold,
      setPlayerName,
      currentFen,
      selectedMoveIndex,
      engine,
      clock,
      configureClock,
      startClock,
      pauseClock,
      meta,
      setMeta,
      getPgn,
      limits,
      setLimits,
      analysisPaused,
      analysisBusy,
      stopAnalysis,
      resumeAnalysis,
      serverEngine,
      backend,
      setBackend,
      infinite,
      setInfinite,
      liveDepth,
    ],
  )

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>
}

export function useGame() {
  const ctx = useContext(GameContext)
  if (!ctx) throw new Error('useGame must be used inside GameProvider')
  return ctx
}
