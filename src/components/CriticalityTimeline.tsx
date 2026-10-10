import { useGame } from '../store/GameContext'
import { criticalityTier } from '../engine/ChessEngine'

/**
 * One bar per position in the game: how critical the decision was for the player
 * about to move (independent of what they played). Click a bar to jump there.
 */
export default function CriticalityTimeline({ compact = false }: { compact?: boolean }) {
  const { moves, currentIndex, navigateTo } = useGame()
  if (moves.length === 0) return null

  const analyzed = moves.filter((m) => m.isAnalyzed).length

  return (
    <div className={compact ? 'mt-1.5' : 'mt-3 pt-3 border-t border-[#2a3648]'}>
      <div className={`flex items-center justify-between ${compact ? 'mb-0.5' : 'mb-1.5'}`}>
        <span className="text-[#8f9db3] text-[10px] uppercase tracking-wider">Momentos críticos</span>
        {analyzed < moves.length && (
          <span className="text-[#5f6d83] text-[10px] font-mono">analisando {analyzed}/{moves.length}</span>
        )}
      </div>
      <div className={`flex items-end gap-px ${compact ? 'h-7' : 'h-12'}`}>
        {moves.map((m, i) => {
          const tier = criticalityTier(m.stakes)
          const active = currentIndex === i
          return (
            <button
              key={i}
              onClick={() => navigateTo(i)}
              title={m.isAnalyzed ? `${m.moveNumber}${m.color === 'w' ? '.' : '…'} ${m.san} — ${tier.label} (${Math.round(m.stakes * 100)}%)` : 'Ainda não analisado'}
              className="flex-1 min-w-[2px] h-full flex items-end group"
            >
              <span
                className={`w-full rounded-t-sm transition-opacity ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}
                style={{
                  height: m.isAnalyzed ? `${Math.max(6, m.stakes * 100)}%` : '4%',
                  backgroundColor: m.isAnalyzed ? tier.color : '#34435a',
                  outline: active ? '1px solid #f1f4f8' : 'none',
                }}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
