import { useState, useEffect } from 'react'
import { useGame } from '../store/GameContext'
import type { EngineLineResult, MoveAnalysis, MoveClassification, EvalScore } from '../types'
import { formatEval, criticalityTier } from '../engine/ChessEngine'
import { wpFor, evalToPawns } from '../engine/metrics'
import TopLines from './TopLines'
import EngineSettings, { ThresholdControl } from './EngineSettings'
import ToMoveCard from './ToMoveCard'
import { Chess } from 'chess.js'
import { moveNumberLabel } from '../lib/notation'

const CLASS_META: Record<MoveClassification, { label: string; color: string; bg: string; symbol: string }> = {
  brilliant: { label: 'Brilhante', color: '#0ea5e9', bg: '#0ea5e920', symbol: '!!' },
  great:     { label: 'Ótimo lance', color: '#2dd4bf', bg: '#2dd4bf20', symbol: '!' },
  best:      { label: 'Melhor lance', color: '#22c55e', bg: '#22c55e20', symbol: '!' },
  excellent: { label: 'Excelente', color: '#4ade80', bg: '#4ade8020', symbol: '✓' },
  good:      { label: 'Bom',       color: '#86efac', bg: '#86efac20', symbol: '' },
  inaccuracy:{ label: 'Imprecisão',color: '#eab308', bg: '#eab30820', symbol: '?!' },
  mistake:   { label: 'Erro',      color: '#f97316', bg: '#f9731620', symbol: '?' },
  blunder:   { label: 'Erro grave', color: '#ef4444', bg: '#ef444420', symbol: '??' },
}

const pct = (v: number) => Math.round(v * 100)

function MetricBar({ label, value, color, hint }: { label: string; value: number; color: string; hint?: string }) {
  return (
    <div title={hint}>
      <div className="flex justify-between items-center mb-1">
        <span className="text-[#8f9db3] text-xs uppercase tracking-wider">{label}</span>
        <span className="text-[#f1f4f8] text-xs font-mono font-bold">{pct(value)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[#2a3648] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out"
          style={{ width: `${pct(value)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function CriticalityBadge({ score }: { score: number }) {
  const { label, color } = criticalityTier(score)
  return (
    <span
      className="inline-flex items-center text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full border"
      style={{ color, borderColor: color + '40', backgroundColor: color + '10' }}
    >
      {label}
    </span>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[#8f9db3] text-[10px] uppercase mb-1">{label}</div>
      <div className="font-mono text-sm font-semibold" style={{ color: color ?? '#f1f4f8' }}>{value}</div>
    </div>
  )
}

function EvalChange({ before, after, delta }: { before: EvalScore | null; after: EvalScore | null; delta: number }) {
  const deltaColor = Math.abs(delta) < 0.05 ? '#8f9db3' : delta > 0 ? '#22c55e' : '#ef4444'
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <Stat label="Antes" value={formatEval(before)} />
      <Stat label="Depois" value={formatEval(after)} />
      <Stat label="Δ" value={`${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`} color={deltaColor} />
    </div>
  )
}

/** Explains, from the extracted signals, why finding the best move was hard. */
function WhyDifficult({ move }: { move: MoveAnalysis }) {
  const reasons: string[] = []
  const gapPts = Math.round(move.gapToSecond * 100)
  if (move.isForced) reasons.push('Só há um lance legal — nada a decidir.')
  else {
    if (move.isOnlyMove) reasons.push(`Só este lance mantém a vantagem: o segundo melhor perde cerca de ${gapPts} pontos de chance de vitória.`)
    else if (gapPts >= 8) reasons.push(`O melhor lance está ${gapPts} pontos de chance de vitória à frente da próxima alternativa.`)
    if (move.acceptableMoves <= 1 && !move.isOnlyMove) reasons.push('Quase todas as alternativas perdem valor.')
    if (move.isSacrifice) reasons.push('A melhor linha entrega material antes de compensar.')
    if (move.traps.length >= 2) {
      const played = move.traps.includes(move.san)
      reasons.push(
        `Lances de aparência natural, como ${move.traps.slice(0, 3).join(', ')}, só falham com cálculo mais profundo` +
          (played ? ` — ${move.san} foi um deles.` : '.'),
      )
    }
    if (move.calculationDepth >= 5) reasons.push(`Ele só se mostra claramente melhor após cerca de ${move.calculationDepth} meios-lances de cálculo.`)
    if (!reasons.length) {
      reasons.push(
        move.acceptableMoves >= 3
          ? `${move.acceptableMoves} lances candidatos são praticamente equivalentes aqui.`
          : 'Uma diferença modesta separa o melhor lance das alternativas.',
      )
    }
  }
  return <p className="text-[#a3afc2] text-xs leading-relaxed">{reasons.join(' ')}</p>
}

/** Bars for the top lines from the mover's point of view, so a lone good move stands out. */
function LinesChart({ lines, color }: { lines: EngineLineResult[]; color: 'w' | 'b' }) {
  const wps = lines.map((l) => wpFor(l.scoreWhitePerspective, color))
  return (
    <div className="space-y-1">
      {lines.map((l, i) => {
        const pawns = evalToPawns(l.scoreWhitePerspective) * (color === 'w' ? 1 : -1)
        return (
          <div key={i} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="w-12 truncate text-[#f1f4f8]">{l.san?.[0] ?? l.pv[0]}</span>
            <span className="w-12 text-right text-[#8f9db3]">{formatEval(l.scoreWhitePerspective)}</span>
            <div className="flex-1 h-2 rounded bg-[#2a3648] overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500"
                style={{ width: `${Math.max(1.5, wps[i] * 100)}%`, backgroundColor: i === 0 ? '#81b64c' : pawns >= 0 ? '#5f6d83' : '#6e4046' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Labelled rule splitting the panel into "now" (the decision ahead) and "past" (the move played). */
function SectionDivider({ label, detail, dot }: { label: string; detail?: string; dot?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />}
      <span className="text-[10px] uppercase tracking-wider font-semibold text-[#a3afc2] shrink-0">{label}</span>
      {detail && <span className="text-[11px] text-[#8f9db3] shrink-0">{detail}</span>}
      <div className="flex-1 h-px bg-[#34435a]" />
    </div>
  )
}

interface Props {
  onPreviewLine?: (moves: string[], fen: string) => void
}

export default function AnalysisPanel({ onPreviewLine }: Props) {
  const {
    moves, currentIndex, mode, liveEval, engineReady, trainingReveal, revealTraining,
    retryMove, livePosition, currentFen,
  } = useGame()
  const [showLines, setShowLines] = useState(false)

  const moveIndex = currentIndex - 1
  const move: MoveAnalysis | null = moveIndex >= 0 ? (moves[moveIndex] ?? null) : null
  const isLast = currentIndex === moves.length

  // Reset show lines when move changes
  useEffect(() => setShowLines(false), [moveIndex])

  if (!engineReady) {
    return (
      <div className="flex flex-col items-center justify-center h-40 gap-3">
        <div className="w-6 h-6 border-2 border-[#81b64c] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#8f9db3] text-sm">Carregando motor…</p>
      </div>
    )
  }

  const hideBest = mode === 'training' && !trainingReveal

  const now = new Chess(currentFen).isGameOver() ? null : (
    <>
      <SectionDivider label="Agora" detail={`${moveNumberLabel(currentFen)} decisão a tomar`} dot="#81b64c" />
      <ToMoveCard onPreviewLine={onPreviewLine} />
    </>
  )
  const past = move && (
    <SectionDivider label="Lance jogado" detail={`${move.moveNumber}${move.color === 'w' ? '.' : '…'} ${move.san}`} dot="#5f6d83" />
  )
  const settings = <SectionDivider label="Configurações" />

  // Start position or no move selected
  if (!move) {
    return (
      <div className="space-y-4">
        {now}
        <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-4">
          <div className="text-[#8f9db3] text-xs uppercase tracking-wider mb-2">Avaliação ao vivo</div>
          <div className="text-2xl font-mono font-bold text-[#f1f4f8]">
            {liveEval ? formatEval(liveEval) : '—'}
          </div>
        </div>
        <div className="text-center text-[#8f9db3] text-sm py-2">
          Jogue um lance ou navegue até um para ver a análise
        </div>
        {settings}
        <ThresholdControl />
        <EngineSettings />
      </div>
    )
  }

  const classMeta = CLASS_META[move.classification]
  const playedBest = move.classification === 'best' || move.classification === 'brilliant' || move.classification === 'great'

  // Coach mode: keep the best move hidden until asked
  if (hideBest) {
    const lost = move.evalLoss
    return (
      <div className="space-y-4">
        {now}
        {past}
        <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-4">
          <div className="text-[#8f9db3] text-xs uppercase tracking-wider mb-2">Seu lance</div>
          <div className="text-xl font-mono font-semibold text-[#f1f4f8]">{move.san}</div>
        </div>

        <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-4 space-y-3">
          {move.isAnalyzed ? (
            <>
              <p className="text-[#f1f4f8] text-sm">
                {move.quality >= 0.9
                  ? '✓ Lance forte — você manteve a avaliação.'
                  : `Você perdeu ${lost.toFixed(1)} pontos de avaliação.`}
              </p>
              {move.difficulty >= 0.6 && (
                <p className="text-[#8f9db3] text-xs">Esta era uma posição de alta dificuldade.</p>
              )}
              {move.criticality > 0.75 && (
                <p className="text-[#8f9db3] text-xs">Muita coisa dependia desta decisão.</p>
              )}
              {move.quality < 0.9 && <p className="text-[#8f9db3] text-xs">Quer tentar novamente?</p>}
            </>
          ) : (
            <p className="text-[#8f9db3] text-sm">Analisando…</p>
          )}
        </div>

        <div className="flex gap-2">
          {isLast && (
            <button
              onClick={retryMove}
              className="flex-1 py-2.5 rounded-lg bg-[#81b64c] text-white text-sm font-medium hover:bg-[#95c95f] transition-colors"
            >
              Tentar novamente
            </button>
          )}
          <button
            onClick={revealTraining}
            className="flex-1 py-2.5 rounded-lg border border-[#81b64c]/40 text-[#81b64c] text-sm font-medium hover:bg-[#81b64c]/10 transition-colors"
          >
            Mostrar melhor lance
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {now}
      {past}
      {/* Move header */}
      <div
        className="rounded-lg border p-3"
        style={{ borderColor: classMeta.color + '40', backgroundColor: classMeta.bg }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-2xl font-mono font-bold text-[#f1f4f8]">
            <span className="text-sm text-[#8f9db3] mr-1">{move.moveNumber}{move.color === 'w' ? '.' : '…'}</span>
            {move.san}
            {classMeta.symbol && (
              <span style={{ color: classMeta.color }} className="ml-1 text-lg">{classMeta.symbol}</span>
            )}
          </span>
          {move.isAnalyzed && <CriticalityBadge score={move.criticality} />}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded"
            style={{ color: classMeta.color, backgroundColor: classMeta.color + '20' }}
          >
            {classMeta.label}
          </span>
          {move.isAnalyzed && move.isCritical && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">
              MOMENTO CRÍTICO
            </span>
          )}
          {move.isOnlyMove && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
              ⚠ LANCE ÚNICO
            </span>
          )}
        </div>
      </div>

      {!move.isAnalyzed ? (
        <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3 flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-[#81b64c] border-t-transparent rounded-full animate-spin shrink-0" />
          <span className="text-[#8f9db3] text-sm">Analisando…</span>
        </div>
      ) : (
        <>
          {/* Three independent metrics */}
          <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3 space-y-3">
            <MetricBar label="Qualidade do lance" value={move.quality} color={classMeta.color} hint="Quão bom foi o lance comparado ao melhor do motor." />
            <MetricBar label="Dificuldade" value={move.difficulty} color="#8b5cf6" hint="Estimativa heurística de quão difícil era achar o melhor lance. Não é uma probabilidade estatística." />
            <MetricBar label="Criticidade" value={move.criticality} color="#f97316" hint="Quanto o resultado dependia de escolher bem nesta posição." />
          </div>

          {/* Eval change */}
          <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3 space-y-3">
            <EvalChange before={move.evalBefore} after={move.evalAfter} delta={move.evalDelta} />
            <div className="flex items-center justify-between border-t border-[#2a3648] pt-2">
              <span className="text-[#8f9db3] text-xs uppercase tracking-wider">Melhor lance</span>
              <span className="text-[#f1f4f8] text-sm font-mono">
                {playedBest ? 'Você jogou ele' : (move.bestMoveSan ?? '—')}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8f9db3] text-xs uppercase tracking-wider" title="Estimado a partir da busca do motor; não é uma verdade absoluta.">Cálculo</span>
              <span className="text-[#f1f4f8] text-sm font-mono">
                ≈ {move.calculationDepth} meios-lances{move.calculationDepth >= 2 ? ` (≈ ${Math.ceil(move.calculationDepth / 2)} lances à frente)` : ''}
              </span>
            </div>
          </div>

          {/* Why difficult */}
          {(move.difficulty > 0.3 || move.isOnlyMove || move.traps.length >= 2) && (
            <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3">
              <div className="text-[#8f9db3] text-[10px] uppercase tracking-wider mb-2">Por que este lance é difícil?</div>
              <WhyDifficult move={move} />
            </div>
          )}

          {/* Alternatives */}
          {move.topLinesBefore.length > 1 && (
            <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3">
              <div className="text-[#8f9db3] text-[10px] uppercase tracking-wider mb-2">Alternativas</div>
              <LinesChart lines={move.topLinesBefore} color={move.color} />
            </div>
          )}

          {move.topLinesBefore.length > 0 && (
            <div>
              <button
                onClick={() => setShowLines((v) => !v)}
                className="w-full py-2 rounded-lg border border-[#34435a] text-[#8f9db3] text-xs font-medium hover:bg-[#2a3648] hover:text-[#f1f4f8] transition-colors"
              >
                {showLines ? '↑ Ocultar' : '↓ Ver'} as {move.topLinesBefore.length} principais linhas
              </button>

              {showLines && (
                <div className="mt-2">
                  <TopLines lines={move.topLinesBefore} fen={move.fenBefore} onPreviewLine={onPreviewLine} />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {settings}
      <ThresholdControl />
      <EngineSettings />
    </div>
  )
}

