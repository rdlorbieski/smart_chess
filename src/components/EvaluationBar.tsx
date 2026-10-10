import { useMemo } from 'react'
import type { EvalScore } from '../types'
import { evalToNumber, formatEval } from '../engine/ChessEngine'

interface Props {
  score: EvalScore | null // white perspective
  isAnalyzing?: boolean
  height?: number | string
  /** Board flipped (Black at the bottom): the bar flips with it so each color faces its own side. */
  flipped?: boolean
}

/** Compact label like chess.com: no sign (the side tells who is better), 1 decimal, M3 for mates. */
function compactLabel(score: EvalScore | null): string {
  if (!score) return '0.0'
  if (score.type === 'mate') return `M${Math.abs(score.value)}`
  if (Math.abs(score.value) >= 9999) return '#'
  const pawns = Math.abs(score.value) / 100
  return pawns >= 10 ? pawns.toFixed(0) : pawns.toFixed(1)
}

/**
 * White's share grows from White's end of the bar (bottom, or top when flipped). The number
 * sits at the end of the side that is better: black digits on the white part when White is
 * better, white digits on the black part when Black is better.
 */
export default function EvaluationBar({ score, isAnalyzing, height = '100%', flipped = false }: Props) {
  const { whitePercent, whiteBetter } = useMemo(() => {
    if (!score) return { whitePercent: 50, whiteBetter: true }
    const num = evalToNumber(score)
    // Sigmoid-like squash: ±5 pawns → near the ends; keep a sliver of the losing color visible.
    const pct = 50 + (50 * num) / (Math.abs(num) + 2.5)
    return { whitePercent: Math.min(97, Math.max(3, pct)), whiteBetter: num >= 0 }
  }, [score])

  const label = compactLabel(score)
  // White's end of the bar is the bottom unless the board is flipped.
  const labelAtBottom = whiteBetter !== flipped

  return (
    <div
      className="relative flex rounded-md overflow-hidden shrink-0"
      style={{ width: 28, height, flexDirection: flipped ? 'column' : 'column-reverse', background: '#403d39' }}
      title={`Avaliação: ${formatEval(score)}`}
    >
      {/* White portion, growing from White's end */}
      <div
        className="transition-all duration-500 ease-out"
        style={{ height: `${whitePercent}%`, background: '#f0f0f0' }}
      />

      {/* Center line */}
      <div className="absolute left-0 right-0 h-px bg-[#888] opacity-50" style={{ top: '50%' }} />

      {/* Score label, on the better side's end */}
      <div
        className="absolute left-0 right-0 flex justify-center"
        style={labelAtBottom ? { bottom: 6 } : { top: 6 }}
      >
        <span
          className="text-[10px] font-mono font-bold leading-none"
          style={{ color: whiteBetter ? '#1a1a1a' : '#f0f0f0' }}
        >
          {label}
        </span>
      </div>

      {isAnalyzing && <div className="absolute inset-0 bg-white opacity-5 animate-pulse" />}
    </div>
  )
}
