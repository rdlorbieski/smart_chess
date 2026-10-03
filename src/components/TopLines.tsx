import { useState } from 'react'
import type { EngineLineResult } from '../types'
import { Chess } from 'chess.js'
import { evalToNumber, formatEval } from '../engine/ChessEngine'
import { wpFor } from '../engine/metrics'

interface Props {
  lines: EngineLineResult[]
  fen: string
  onPreviewLine?: (moves: string[]) => void
}

export default function TopLines({ lines, fen, onPreviewLine }: Props) {
  const [hovered, setHovered] = useState<number | null>(null)

  if (!lines.length) {
    return (
      <div className="text-[#7d8590] text-sm text-center py-4">
        Nenhuma análise disponível
      </div>
    )
  }

  const mover = new Chess(fen).turn()
  const sign = mover === 'w' ? 1 : -1
  const bestScore = sign * evalToNumber(lines[0].scoreWhitePerspective)

  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const score = sign * evalToNumber(line.scoreWhitePerspective)
        const diff = score - bestScore // from the side to move, relative to the best line
        const barPct = wpFor(line.scoreWhitePerspective, mover)
        const isPositive = score >= 0
        const isHovered = hovered === i

        return (
          <div
            key={i}
            className={`
              rounded-md p-2.5 cursor-pointer border transition-all duration-150
              ${i === 0
                ? 'border-[#388bfd]/30 bg-[#388bfd]/5'
                : 'border-[#30363d] bg-[#161b22]'
              }
              ${isHovered ? 'border-[#388bfd]/50 bg-[#21262d]' : ''}
            `}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onPreviewLine?.(line.pv)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[#7d8590] text-xs font-mono">{i + 1}.</span>
                <span className="text-[#e6edf3] text-sm font-mono font-semibold">
                  {line.san?.[0] ?? line.pv[0]}
                </span>
                {line.san && line.san.length > 1 && (
                  <span className="text-[#7d8590] text-xs font-mono truncate max-w-[120px]">
                    {line.san.slice(1, 5).join(' ')}
                    {line.san.length > 5 ? '...' : ''}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {i > 0 && (
                  <span className="text-[#7d8590] text-xs font-mono">
                    {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                  </span>
                )}
                <span
                  className="text-sm font-mono font-bold"
                  style={{ color: isPositive ? '#e6edf3' : '#7d8590' }}
                >
                  {formatEval(line.scoreWhitePerspective)}
                </span>
              </div>
            </div>

            {/* Bar */}
            <div className="h-1 rounded-full bg-[#21262d] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.max(2, barPct * 100)}%`,
                  backgroundColor: i === 0 ? '#388bfd' : '#30363d',
                }}
              />
            </div>

            <div className="mt-1 text-[#7d8590] text-[10px] font-mono">
              depth {line.depth}
            </div>
          </div>
        )
      })}
    </div>
  )
}
