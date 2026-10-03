import { useMemo } from 'react'
import { useGame } from '../store/GameContext'
import { winProbability } from '../engine/metrics'
import type { Color, MoveAnalysis, MoveClassification } from '../types'

const CLASS_ROWS: { key: MoveClassification; label: string; symbol: string; color: string }[] = [
  { key: 'brilliant', label: 'Brilhante', symbol: '!!', color: '#0ea5e9' },
  { key: 'great', label: 'Ótimo', symbol: '!', color: '#2dd4bf' },
  { key: 'best', label: 'Melhor', symbol: '★', color: '#22c55e' },
  { key: 'excellent', label: 'Excelente', symbol: '✓', color: '#4ade80' },
  { key: 'good', label: 'Bom', symbol: '·', color: '#86efac' },
  { key: 'inaccuracy', label: 'Imprecisão', symbol: '?!', color: '#eab308' },
  { key: 'mistake', label: 'Erro', symbol: '?', color: '#f97316' },
  { key: 'blunder', label: 'Erro grave', symbol: '??', color: '#ef4444' },
]

/**
 * Per-move accuracy from the win-probability lost (Lichess' published formula), 0–100.
 * Game accuracy blends the arithmetic and harmonic means so a single blunder weighs in.
 * An estimate, like every metric here — not chess.com's proprietary CAPS number.
 */
const moveAccuracy = (m: MoveAnalysis) => {
  const lossPct = Math.max(0, m.wpBefore - m.wpAfter) * 100
  return Math.min(100, Math.max(0, 103.1668 * Math.exp(-0.04354 * lossPct) - 3.1669))
}
function gameAccuracy(moves: MoveAnalysis[]): number | null {
  if (!moves.length) return null
  const acc = moves.map(moveAccuracy)
  const mean = acc.reduce((a, b) => a + b, 0) / acc.length
  const harmonic = acc.length / acc.reduce((a, b) => a + 1 / Math.max(b, 1), 0)
  return (mean + harmonic) / 2
}

/** White's win probability after each ply (0.5 at the start), as an area chart. */
function EvalGraph({ moves, currentIndex, onSelect }: { moves: MoveAnalysis[]; currentIndex: number; onSelect: (ply: number) => void }) {
  const W = 300
  const H = 90
  const pts = [0.5, ...moves.map((m) => (m.isAnalyzed && m.evalAfter ? winProbability(m.evalAfter) : NaN))]
  // Unanalyzed plies reuse the previous value so the line stays continuous.
  for (let i = 1; i < pts.length; i++) if (Number.isNaN(pts[i])) pts[i] = pts[i - 1]
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0)
  const y = (p: number) => H - p * H
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p).toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const marks = moves
    .map((m, i) => ({ m, ply: i + 1 }))
    .filter(({ m }) => m.isAnalyzed && (m.classification === 'blunder' || m.classification === 'mistake' || m.classification === 'brilliant'))

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-24 rounded cursor-pointer select-none"
      preserveAspectRatio="none"
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
        onSelect(Math.round(((e.clientX - r.left) / r.width) * (pts.length - 1)))
      }}
    >
      <rect width={W} height={H} fill="#403d39" />
      <path d={area} fill="#f0f0f0" />
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="#888" strokeWidth="0.5" strokeDasharray="3 3" />
      {pts.length > 1 && (
        <line x1={x(currentIndex)} x2={x(currentIndex)} y1="0" y2={H} stroke="#388bfd" strokeWidth="1.5" />
      )}
      {marks.map(({ m, ply }) => (
        <circle
          key={ply}
          cx={x(ply)}
          cy={y(pts[ply])}
          r="2.6"
          fill={m.classification === 'blunder' ? '#ef4444' : m.classification === 'mistake' ? '#f97316' : '#0ea5e9'}
          stroke="#0d1117"
          strokeWidth="0.6"
        >
          <title>{`${m.moveNumber}${m.color === 'w' ? '.' : '…'} ${m.san} — ${CLASS_ROWS.find((r) => r.key === m.classification)?.label}`}</title>
        </circle>
      ))}
    </svg>
  )
}

export default function GameReport() {
  const { moves, currentIndex, navigateTo, playerWhite, playerBlack, analysisPaused, resumeAnalysis } = useGame()

  const analyzed = moves.filter((m) => m.isAnalyzed)
  const bySide = useMemo(() => {
    const side = (c: Color) => {
      const ms = analyzed.filter((m) => m.color === c)
      const counts = Object.fromEntries(CLASS_ROWS.map((r) => [r.key, ms.filter((m) => m.classification === r.key).length]))
      return { accuracy: gameAccuracy(ms), counts }
    }
    return { w: side('w'), b: side('b') }
  }, [analyzed])

  // Key moments: the costliest errors and the most critical decisions, in game order.
  const keyMoments = useMemo(() => {
    const items = moves
      .map((m, i) => ({ m, ply: i + 1 }))
      .filter(({ m }) => m.isAnalyzed && (m.classification === 'blunder' || m.classification === 'mistake' || m.classification === 'brilliant' || m.isCritical))
      .sort((a, b) => b.m.criticality - a.m.criticality)
      .slice(0, 6)
    return items.sort((a, b) => a.ply - b.ply)
  }, [moves])

  if (!moves.length) {
    return <p className="text-center text-[#7d8590] text-sm py-6">Carregue ou jogue uma partida para ver o relatório.</p>
  }

  const pct = (v: number | null) => (v === null ? '—' : v.toFixed(1))

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3 space-y-2">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[#7d8590]">
          <span>Avaliação</span>
          <span className="font-mono normal-case">
            {analyzed.length < moves.length ? `analisando ${analyzed.length}/${moves.length}` : `${moves.length} lances`}
          </span>
        </div>
        <EvalGraph moves={moves} currentIndex={currentIndex} onSelect={navigateTo} />
        {analysisPaused && analyzed.length < moves.length && (
          <button onClick={resumeAnalysis} className="w-full text-xs py-1.5 rounded border border-[#388bfd]/40 text-[#388bfd] hover:bg-[#388bfd]/10">
            ▶ Retome a análise para terminar o relatório
          </button>
        )}
      </div>

      <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 items-center text-xs">
          <span />
          <span className="text-right text-[#e6edf3] font-semibold truncate max-w-[90px]" title={playerWhite}>{playerWhite}</span>
          <span className="text-right text-[#e6edf3] font-semibold truncate max-w-[90px]" title={playerBlack}>{playerBlack}</span>

          <span className="text-[#7d8590] uppercase text-[10px] tracking-wider" title="Estimativa a partir da chance de vitória perdida por lance (fórmula do Lichess)">
            Precisão
          </span>
          <span className="text-right">
            <span className="inline-block min-w-[46px] text-center font-mono font-bold rounded px-1.5 py-0.5 bg-[#f0f0f0] text-[#0d1117]">{pct(bySide.w.accuracy)}</span>
          </span>
          <span className="text-right">
            <span className="inline-block min-w-[46px] text-center font-mono font-bold rounded px-1.5 py-0.5 bg-[#403d39] text-[#f0f0f0]">{pct(bySide.b.accuracy)}</span>
          </span>

          {CLASS_ROWS.map((r) => (
            <div key={r.key} className="contents">
              <span className="flex items-center gap-1.5 text-[#8b949e]">
                <span className="w-5 text-center font-mono font-bold" style={{ color: r.color }}>{r.symbol}</span>
                {r.label}
              </span>
              <span className="text-right font-mono" style={{ color: bySide.w.counts[r.key] ? r.color : '#484f58' }}>{bySide.w.counts[r.key]}</span>
              <span className="text-right font-mono" style={{ color: bySide.b.counts[r.key] ? r.color : '#484f58' }}>{bySide.b.counts[r.key]}</span>
            </div>
          ))}
        </div>
      </div>

      {keyMoments.length > 0 && (
        <div className="rounded-lg border border-[#30363d] bg-[#161b22] p-3">
          <div className="text-[10px] uppercase tracking-wider text-[#7d8590] mb-2">Momentos decisivos</div>
          <ul className="space-y-1">
            {keyMoments.map(({ m, ply }) => {
              const row = CLASS_ROWS.find((r) => r.key === m.classification)!
              const swing = Math.round((m.wpBefore - m.wpAfter) * 100)
              return (
                <li key={ply}>
                  <button
                    onClick={() => navigateTo(ply)}
                    className={`w-full text-left px-2 py-1.5 rounded border text-xs ${currentIndex === ply ? 'border-[#388bfd]/60 bg-[#388bfd]/10' : 'border-[#30363d] bg-[#0d1117] hover:bg-[#21262d]'}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[#7d8590]">{m.moveNumber}{m.color === 'w' ? '.' : '…'}</span>
                      <span className="font-mono font-semibold text-[#e6edf3]">{m.san}</span>
                      <span className="font-mono font-bold" style={{ color: row.color }}>{row.symbol}</span>
                      <span className="ml-auto text-[10px] text-[#7d8590]">criticidade {Math.round(m.criticality * 100)}%</span>
                    </div>
                    <div className="text-[10px] text-[#7d8590] mt-0.5">
                      {m.color === 'w' ? playerWhite : playerBlack}: {row.label.toLowerCase()}
                      {swing > 1 && ['inaccuracy', 'mistake', 'blunder'].includes(m.classification) ? ` · perdeu ${swing} pts de chance de vitória` : ''}
                      {m.bestMoveSan && m.bestMoveSan !== m.san ? ` · o melhor era ${m.bestMoveSan}` : ''}
                      {m.traps.includes(m.san) ? ' · uma armadilha oculta' : ''}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
