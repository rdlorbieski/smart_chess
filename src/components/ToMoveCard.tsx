import { useEffect, useState } from 'react'
import { Chess } from 'chess.js'
import { useGame } from '../store/GameContext'
import { criticalityTier, formatEval, pvToSan } from '../engine/ChessEngine'
import { wpFor } from '../engine/metrics'
import { moveNumberLabel, numberedTokens } from '../lib/notation'

function Bar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100)
  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[#8f9db3] text-[10px] uppercase tracking-wider">{label}</span>
        <span className="text-[#f1f4f8] text-xs font-mono font-bold">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#2a3648] overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700 ease-out" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

/**
 * Moves that look fine at the glance depth but lose deeper: the move, how much it loses, and
 * the best line with it at the glance depth (why it looks fine). Click to see it on the board.
 */
function GlanceList({ moves, depth, fen, hover, onPreviewLine }: {
  moves: { uci: string; san: string; loss: number; pv?: string[] }[]
  depth: number
  fen: string
  hover: string
  onPreviewLine?: (moves: string[]) => void
}) {
  return (
    <div className="space-y-1">
      {moves.map((t) => {
        const line = t.pv?.length ? numberedTokens(pvToSan(fen, t.pv), fen) : []
        return (
          <button
            key={t.uci}
            onClick={() => t.pv && onPreviewLine?.(t.pv)}
            title={`Melhor linha com ${t.san} na profundidade ${depth} — clique para ver no tabuleiro`}
            className={`w-full flex items-start gap-2 text-left rounded px-1 py-0.5 ${hover}`}
          >
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#1a2230] border border-[#34435a] font-mono text-[11px] text-[#f1f4f8]">
              {t.san}{' '}
              <span style={{ color: t.loss >= 0.2 ? '#ef4444' : t.loss >= 0.14 ? '#f87171' : '#fca5a5' }}>
                −{Math.round(t.loss * 100)}%
              </span>
            </span>
            {line.length > 0 && (
              <span className="min-w-0 pt-0.5 font-mono text-[11px] leading-snug text-[#a3afc2]">
                <span className="text-[#5f6d83]">prof. {depth}:</span> {line.join(' ')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * How hard and how critical the decision is for the side that has NOT moved yet in the
 * displayed position — what a player faces at the board. Never reveals the best move.
 */
export default function ToMoveCard({ onPreviewLine }: { onPreviewLine?: (moves: string[]) => void }) {
  const { currentFen, livePosition, playerWhite, playerBlack, engine, mode, trainingReveal } = useGame()
  const [open, setOpen] = useState(false)
  const [trapsOpen, setTrapsOpen] = useState(false)
  const [sacsOpen, setSacsOpen] = useState(false)
  // Collapse when the position changes so the lists never show moves from another position.
  useEffect(() => {
    setOpen(false)
    setTrapsOpen(false)
    setSacsOpen(false)
  }, [currentFen])

  const chess = new Chess(currentFen)
  if (chess.isGameOver()) return null

  const turn = chess.turn()
  const name = turn === 'w' ? playerWhite : playerBlack
  const ready = livePosition && livePosition.fen === currentFen ? livePosition : null
  // Listing the good moves gives the answer away, so Coach mode keeps it locked until the reveal.
  const locked = mode === 'training' && !trainingReveal

  const wps = ready ? ready.lines.map((l) => wpFor(l.scoreWhitePerspective, turn)) : []
  const good = ready
    ? ready.lines.filter((_, i) => wps[0] - wps[i] <= engine.config.acceptableWindow)
    : []

  return (
    <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-3 h-3 rounded-full border shrink-0"
            style={{ background: turn === 'w' ? '#f0f0f0' : '#1a1a1a', borderColor: turn === 'w' ? '#888' : '#555' }}
          />
          <span className="text-sm text-[#f1f4f8] font-semibold truncate">{name}</span>
          <span className="text-[#8f9db3] text-xs shrink-0">a jogar</span>
        </div>
        {ready && !ready.isForced && (
          <span
            className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border shrink-0"
            style={{
              color: criticalityTier(ready.criticality).color,
              borderColor: criticalityTier(ready.criticality).color + '40',
              backgroundColor: criticalityTier(ready.criticality).color + '10',
            }}
          >
            {criticalityTier(ready.criticality).label}
          </span>
        )}
      </div>

      {!ready ? (
        <div className="flex items-center gap-2 text-[#8f9db3] text-xs">
          <div className="w-3.5 h-3.5 border-2 border-[#81b64c] border-t-transparent rounded-full animate-spin" />
          Avaliando a decisão…
        </div>
      ) : ready.isForced ? (
        <p className="text-[#8f9db3] text-xs">Só há um lance legal — nada a decidir.</p>
      ) : (
        <>
          <Bar label="Criticidade" value={ready.criticality} color="#f97316" />
          <Bar label="Dificuldade" value={ready.difficulty} color="#8b5cf6" />
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            {ready.isOnlyMove && (
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">⚠ LANCE ÚNICO</span>
            )}
            <button
              onClick={() => setOpen((o) => !o)}
              disabled={locked}
              title={locked ? 'Oculto no modo Treino até revelar o melhor lance' : 'Mostrar estes lances'}
              className={`px-2 py-0.5 rounded bg-[#2a3648] text-[#8f9db3] ${locked ? 'cursor-not-allowed opacity-70' : 'hover:text-[#f1f4f8] hover:bg-[#34435a]'}`}
            >
              {ready.acceptableMoves} {ready.acceptableMoves === 1 ? 'boa opção' : 'boas opções'} {locked ? '🔒' : open ? '▴' : '▾'}
            </button>
            <span className="px-2 py-0.5 rounded bg-[#2a3648] text-[#8f9db3]" title="Estimado a partir da busca do motor; não é uma verdade absoluta.">
              ≈ {ready.calculationDepth} meios-lances
            </span>
            {!ready.scanned ? (
              <span className="px-2 py-0.5 rounded bg-[#2a3648] text-[#5f6d83] animate-pulse" title="Varrendo todos os lances legais em busca de armadilhas">
                varrendo todos os lances…
              </span>
            ) : (
              <>
                {ready.traps && ready.traps.traps.length > 0 && (
                  <button
                    onClick={() => setTrapsOpen((o) => !o)}
                    disabled={locked}
                    title={locked ? 'Oculto no modo Treino até revelar o melhor lance' : 'Lances de aparência natural que falham com cálculo mais fundo'}
                    className={`px-2 py-0.5 rounded bg-red-500/15 text-red-300 font-semibold ${locked ? 'cursor-not-allowed opacity-70' : 'hover:bg-red-500/25'}`}
                  >
                    ⚠ {ready.traps.traps.length} {ready.traps.traps.length === 1 ? 'armadilha oculta' : 'armadilhas ocultas'} {locked ? '🔒' : trapsOpen ? '▴' : '▾'}
                  </button>
                )}
                {ready.traps && ready.traps.sacrifices.length > 0 && (
                  <button
                    onClick={() => setSacsOpen((o) => !o)}
                    disabled={locked}
                    title={locked ? 'Oculto no modo Treino até revelar o melhor lance' : 'Lances que entregam material e parecem compensar num olhar rápido, mas não compensam'}
                    className={`px-2 py-0.5 rounded bg-orange-500/15 text-orange-300 font-semibold ${locked ? 'cursor-not-allowed opacity-70' : 'hover:bg-orange-500/25'}`}
                  >
                    ⚔ {ready.traps.sacrifices.length} {ready.traps.sacrifices.length === 1 ? 'sacrifício que falha' : 'sacrifícios que falham'} {locked ? '🔒' : sacsOpen ? '▴' : '▾'}
                  </button>
                )}
              </>
            )}
          </div>

          {trapsOpen && !locked && ready.traps && ready.traps.traps.length > 0 && (
            <div className="rounded border border-red-500/20 bg-red-500/5 p-2 space-y-1.5">
              <p className="text-[#a3afc2] text-[11px] leading-relaxed">
                Parecem bons num olhar rápido (profundidade {ready.traps.glanceDepth}), mas perdem com cálculo mais fundo (profundidade{' '}
                {ready.traps.deepDepth}). {ready.traps.traps.length} dos {ready.traps.plausible} lances naturais são
                armadilhas; {ready.traps.goodMoves} dos {ready.traps.legal} lances legais seguram a posição.
              </p>
              <GlanceList moves={ready.traps.traps} depth={ready.traps.glanceDepth} fen={currentFen} hover="hover:bg-red-500/10" onPreviewLine={onPreviewLine} />
            </div>
          )}

          {sacsOpen && !locked && ready.traps && ready.traps.sacrifices.length > 0 && (
            <div className="rounded border border-orange-500/20 bg-orange-500/5 p-2 space-y-1.5">
              <p className="text-[#a3afc2] text-[11px] leading-relaxed">
                Deixam material para ser capturado. Num olhar rápido (profundidade {ready.traps.glanceDepth}) parece que ele volta
                ou que há compensação, mas com cálculo mais fundo (profundidade {ready.traps.deepDepth}) não compensa. Não contam
                como armadilhas ocultas.
              </p>
              <GlanceList moves={ready.traps.sacrifices} depth={ready.traps.glanceDepth} fen={currentFen} hover="hover:bg-orange-500/10" onPreviewLine={onPreviewLine} />
            </div>
          )}

          {open && !locked && (
            <div className="space-y-1 pt-1">
              {good.map((l, i) => {
                const drop = Math.round((wps[0] - wpFor(l.scoreWhitePerspective, turn)) * 100)
                return (
                  <button
                    key={l.multipv}
                    onClick={() => onPreviewLine?.(l.pv)}
                    title="Ver esta linha no tabuleiro"
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded border border-[#34435a] bg-[#1a2230] hover:bg-[#2a3648] text-left"
                  >
                    <span className="text-[#8f9db3] text-[11px] font-mono shrink-0">{moveNumberLabel(currentFen)}</span>
                    <span className="text-[#f1f4f8] text-sm font-mono font-semibold -ml-1.5">{l.san?.[0] ?? l.pv[0]}</span>
                    <span className="text-[#8f9db3] text-[11px] font-mono truncate flex-1">
                      {numberedTokens((l.san ?? l.pv).slice(0, 4), currentFen).slice(1).join(' ')}
                    </span>
                    <span className="text-[#f1f4f8] text-xs font-mono">{formatEval(l.scoreWhitePerspective)}</span>
                    <span className="text-[#8f9db3] text-[10px] font-mono w-8 text-right">{i === 0 ? 'melhor' : `−${drop}%`}</span>
                  </button>
                )
              })}
              {ready.acceptableMoves < ready.lines.length && (
                <p className="text-[#5f6d83] text-[10px]">
                  As outras {ready.lines.length - ready.acceptableMoves} das {ready.lines.length} principais linhas perdem bem mais.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
