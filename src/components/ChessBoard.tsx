import { useEffect, useMemo, useRef, useState } from 'react'
import { numberedTokens } from '../lib/notation'
import { playSound, soundForSan } from '../lib/sound'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key, Color as CgColor, Dests } from 'chessground/types'
import type { DrawBrushes, DrawShape } from 'chessground/draw'
import { Chess } from 'chess.js'
import { useGame } from '../store/GameContext'
import { wpFor } from '../engine/metrics'

// Best line = strongest, widest green; each next candidate fades toward warm, thinner arrows.
const ARROW_BRUSHES = [
  { key: 'rank1', color: '#15a34a', opacity: 0.95, lineWidth: 15 },
  { key: 'rank2', color: '#4ade80', opacity: 0.85, lineWidth: 12 },
  { key: 'rank3', color: '#a3e635', opacity: 0.8, lineWidth: 10 },
  { key: 'rank4', color: '#facc15', opacity: 0.75, lineWidth: 8 },
  { key: 'rank5', color: '#fb923c', opacity: 0.7, lineWidth: 6 },
]
// Candidates this far below the best line (win-probability) are not worth an arrow.
const ARROW_WINDOW = 0.2

// Hidden traps (look fine, lose on calculation): reds, darker = more costly.
const TRAP_BRUSHES = [
  { key: 'trapSevere', color: '#991b1b', opacity: 0.9, lineWidth: 9 }, // loses >= 20 points
  { key: 'trapHigh', color: '#dc2626', opacity: 0.85, lineWidth: 8 }, // >= 14
  { key: 'trapMild', color: '#f87171', opacity: 0.8, lineWidth: 7 }, // >= 10
]
const MAX_TRAP_ARROWS = 6
const trapBrush = (loss: number) => (loss >= 0.2 ? 'trapSevere' : loss >= 0.14 ? 'trapHigh' : 'trapMild')

function getLegalDests(fen: string): Dests {
  const chess = new Chess(fen)
  const dests: Dests = new Map()
  chess.moves({ verbose: true }).forEach((m) => {
    const from = m.from as Key
    if (!dests.has(from)) dests.set(from, [])
    dests.get(from)!.push(m.to as Key)
  })
  return dests
}

/**
 * chessground's piece art is keyed on a <piece> element (`.cg-wrap piece.queen.white`).
 * React warns about unknown lowercase tags, so the element is created through the DOM.
 */
function CgPiece({ className }: { className: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const el = document.createElement('piece')
    el.className = className
    ref.current?.replaceChildren(el)
  }, [className])
  return <span ref={ref} className="contents" />
}

/** A line to play on the board (UCI moves from `fen`) without touching the game. */
export interface PreviewLine {
  fen: string
  moves: string[]
}

interface PreviewStep {
  fen: string
  lastMove?: [Key, Key]
  san?: string
}

/** Positions along a previewed line: the start, then one per legal move (stops at the first illegal one). */
function previewSteps(line: PreviewLine): PreviewStep[] {
  const chess = new Chess(line.fen)
  const steps: PreviewStep[] = [{ fen: line.fen }]
  for (const uci of line.moves) {
    try {
      const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })
      steps.push({ fen: chess.fen(), lastMove: [m.from as Key, m.to as Key], san: m.san })
    } catch {
      break
    }
  }
  return steps
}

const PREVIEW_FIRST_MS = 500
const PREVIEW_STEP_MS = 1000

interface Props {
  preview?: PreviewLine | null
  onClearPreview?: () => void
}

export default function ChessBoard({ preview, onClearPreview }: Props) {
  const {
    currentFen, makeMove, orientation, moves, currentIndex, navigateBack, navigateForward,
    livePosition, showArrows, showTrapArrows, mode, trainingReveal,
  } = useGame()

  const cgRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<Api | null>(null)

  // Keep latest callback in a ref to avoid stale closures
  const makeMoveRef = useRef(makeMove)
  useEffect(() => { makeMoveRef.current = makeMove }, [makeMove])
  const fenRef = useRef(currentFen)
  fenRef.current = currentFen

  // Pending promotion: the pawn reached the last rank; ask which piece before playing it.
  const [promo, setPromo] = useState<{ orig: string; dest: string; color: 'w' | 'b' } | null>(null)
  const onUserMove = useRef((orig: string, dest: string) => {
    const chess = new Chess(fenRef.current)
    const mv = chess.moves({ verbose: true }).find((m) => m.from === orig && m.to === dest)
    if (mv?.promotion) setPromo({ orig, dest, color: mv.color })
    else makeMoveRef.current(orig, dest)
  })
  const choosePromotion = (piece: 'q' | 'r' | 'b' | 'n' | null) => {
    const p = promo
    setPromo(null)
    if (p && piece) makeMoveRef.current(p.orig, p.dest, piece)
    else apiRef.current?.set({ fen: fenRef.current }) // cancelled: put the pawn back
  }

  // Sound when the position advances by one ply (a move played or stepping forward).
  const prevPly = useRef({ index: currentIndex, fen: currentFen })
  useEffect(() => {
    const prev = prevPly.current
    if (currentIndex === prev.index + 1 && moves[currentIndex - 1]?.fenBefore === prev.fen) {
      playSound(soundForSan(moves[currentIndex - 1].san))
    }
    prevPly.current = { index: currentIndex, fen: currentFen }
  }, [currentIndex, currentFen, moves])

  // Initialize once
  useEffect(() => {
    if (!cgRef.current) return
    const chess = new Chess(currentFen)
    const color: CgColor = chess.turn() === 'w' ? 'white' : 'black'

    apiRef.current = Chessground(cgRef.current, {
      fen: currentFen,
      orientation,
      turnColor: color,
      movable: {
        color,
        free: false,
        dests: getLegalDests(currentFen),
        showDests: true,
        events: {
          after: (orig: Key, dest: Key) => onUserMove.current(orig, dest),
        },
      },
      draggable: { enabled: true, showGhost: true },
      selectable: { enabled: true },
      coordinates: true,
      coordinatesOnSquares: false, // ranks on the a-file, letters on rank 1 (styled in index.css)
      highlight: { lastMove: true, check: true },
      animation: { enabled: true, duration: 180 },
      premovable: { enabled: false },
      drawable: {
        enabled: true,
        visible: true,
        // chessground merges these into its default brushes
        brushes: Object.fromEntries([...ARROW_BRUSHES, ...TRAP_BRUSHES].map((br) => [br.key, br])) as unknown as DrawBrushes,
      },
    })

    // Re-render when size changes (e.g. sidebar collapse, window resize)
    const ro = new ResizeObserver(() => apiRef.current?.redrawAll())
    ro.observe(cgRef.current)

    return () => {
      ro.disconnect()
      apiRef.current?.destroy()
      apiRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Previewed line: played on the board one move per second, then held on the last position
  // until the user leaves it (✕, Esc, or navigating). The game itself is never touched.
  const steps = useMemo(() => (preview ? previewSteps(preview) : null), [preview])
  const [step, setStep] = useState(0)
  const [run, setRun] = useState(0) // bumped by "replay"
  useEffect(() => setStep(0), [steps, run])
  useEffect(() => {
    if (!steps || step >= steps.length - 1) return
    const t = setTimeout(() => {
      const next = steps[step + 1]
      if (next.san) playSound(soundForSan(next.san))
      setStep(step + 1)
    }, step === 0 ? PREVIEW_FIRST_MS : PREVIEW_STEP_MS)
    return () => clearTimeout(t)
  }, [steps, step])

  // Update position, orientation, last move
  useEffect(() => {
    if (!apiRef.current) return
    if (steps) {
      const s = steps[Math.min(step, steps.length - 1)]
      const chess = new Chess(s.fen)
      const color: CgColor = chess.turn() === 'w' ? 'white' : 'black'
      apiRef.current.set({
        fen: s.fen,
        orientation,
        turnColor: color,
        lastMove: s.lastMove,
        check: chess.isCheck() ? color : undefined,
        movable: { color: undefined, dests: new Map() }, // read-only while previewing
      })
      return
    }
    const chess = new Chess(currentFen)
    const color: CgColor = chess.turn() === 'w' ? 'white' : 'black'
    const dests = getLegalDests(currentFen)

    const prevMove = currentIndex > 0 ? moves[currentIndex - 1] : undefined
    const lastMove: [Key, Key] | undefined = prevMove
      ? [prevMove.uci.slice(0, 2) as Key, prevMove.uci.slice(2, 4) as Key]
      : undefined

    apiRef.current.set({
      fen: currentFen,
      orientation,
      turnColor: color,
      lastMove,
      check: chess.isCheck() ? color : undefined,
      movable: { color, dests },
    })
  }, [currentFen, orientation, currentIndex, moves, steps, step])

  // Arrows: the engine's best candidates for the side to move (none while a line is being
  // previewed). Hidden in Coach mode until the best move is revealed, and when switched off.
  useEffect(() => {
    if (!apiRef.current) return
    let shapes: DrawShape[] = []
    if (steps) {
      shapes = []
    } else if ((showArrows || showTrapArrows) && !(mode === 'training' && !trainingReveal) && livePosition?.fen === currentFen) {
      const turn = new Chess(currentFen).turn()
      const traps = livePosition.traps?.traps ?? []
      const trapSet = new Set(traps.map((t) => t.uci))
      const lines = livePosition.lines.filter((l) => l.pv.length > 0)
      const best = lines.length ? wpFor(lines[0].scoreWhitePerspective, turn) : 0
      const goodShapes: DrawShape[] = !showArrows
        ? []
        : lines
            // A trap can sit inside the green window (it loses 10–20 points); never paint it green.
            .filter((l) => best - wpFor(l.scoreWhitePerspective, turn) <= ARROW_WINDOW && !trapSet.has(l.pv[0]))
            .slice(0, ARROW_BRUSHES.length)
            .map((l, i) => ({
              orig: l.pv[0].slice(0, 2) as Key,
              dest: l.pv[0].slice(2, 4) as Key,
              brush: ARROW_BRUSHES[i].key,
            }))
      // Hidden traps in red: the costlier the trap, the darker the red. Drawn first so the
      // good-move arrows stay on top where they overlap.
      const trapShapes: DrawShape[] = !showTrapArrows
        ? []
        : traps.slice(0, MAX_TRAP_ARROWS).map((t) => ({
            orig: t.uci.slice(0, 2) as Key,
            dest: t.uci.slice(2, 4) as Key,
            brush: trapBrush(t.loss),
          }))
      shapes = [...trapShapes, ...goodShapes]
    }
    apiRef.current.setAutoShapes(shapes)
  }, [steps, showArrows, showTrapArrows, mode, trainingReveal, livePosition, currentFen])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') navigateBack()
      else if (e.key === 'ArrowRight') navigateForward()
      else if (e.key === 'Escape') onClearPreview?.()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigateBack, navigateForward, onClearPreview])

  const tokens = preview && steps ? numberedTokens(steps.slice(1).map((s) => s.san!), preview.fen) : []
  const playing = !!steps && step < steps.length - 1

  return (
    <div className="w-full flex flex-col gap-1">
      <div className="cg-board-wrapper relative">
        <div ref={cgRef} className="cg-wrap" />
        {steps && (
          // Sits over the top nameplate (just above the board), so no square is hidden.
          <div className="absolute bottom-full mb-1 left-0 right-0 z-10 min-h-[40px] flex items-center gap-2 rounded-md bg-[#151c28] border border-[#34435a] px-2.5 py-1.5 shadow-lg">
            <span className="shrink-0 text-[10px] uppercase tracking-wider font-semibold text-[#81b64c] pt-0.5">
              {playing ? '▶ Linha' : 'Linha'}
            </span>
            <span className="flex-1 min-w-0 flex flex-wrap gap-x-1.5 gap-y-0.5 text-[12px] font-mono leading-snug">
              {tokens.map((t, i) => (
                <span
                  key={i}
                  className={i + 1 === step ? 'text-white font-bold bg-[#4a5b75] rounded px-1 -mx-1' : i + 1 < step ? 'text-[#d5dbe5]' : 'text-[#5f6d83]'}
                >
                  {t}
                </span>
              ))}
            </span>
            <button
              onClick={() => setRun((r) => r + 1)}
              className="shrink-0 text-[11px] text-[#a3afc2] hover:text-white px-1"
              title="Repetir a linha"
            >
              ⟲
            </button>
            <button
              onClick={onClearPreview}
              className="shrink-0 text-[11px] text-[#a3afc2] hover:text-white px-1"
              title="Voltar à posição da partida (Esc)"
            >
              ✕
            </button>
          </div>
        )}
        {promo && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-[1px]"
            onClick={() => choosePromotion(null)}
          >
            {/* .cg-wrap so chessground's own piece art (cburnett) applies; .cg-promo undoes board layout */}
            <div
              className="cg-wrap cg-promo flex gap-2 rounded-xl bg-[#212b3a] border border-[#34435a] p-3 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Escolha a peça da promoção"
            >
              {(['q', 'r', 'b', 'n'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => choosePromotion(p)}
                  title={{ q: 'Dama', r: 'Torre', b: 'Bispo', n: 'Cavalo' }[p]}
                  className="w-16 h-16 rounded-lg bg-[#ebecd0] hover:bg-[#f5f682] transition-colors flex items-center justify-center"
                >
                  <CgPiece className={`${promo.color === 'w' ? 'white' : 'black'} ${{ q: 'queen', r: 'rook', b: 'bishop', n: 'knight' }[p]}`} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
