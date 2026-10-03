import { useEffect, useRef } from 'react'
import type { MoveAnalysis, MoveClassification } from '../types'
import { useGame } from '../store/GameContext'

const CLASS_COLORS: Record<MoveClassification, { bg: string; text: string; label: string }> = {
  brilliant: { bg: '#0ea5e9', text: '#fff', label: '!!' },
  great:     { bg: '#2dd4bf', text: '#042f2e', label: '!' },
  best:      { bg: '#22c55e', text: '#fff', label: '!' },
  excellent: { bg: '#4ade80', text: '#14532d', label: '✓' },
  good:      { bg: '#86efac', text: '#14532d', label: '' },
  inaccuracy:{ bg: '#eab308', text: '#422006', label: '?!' },
  mistake:   { bg: '#f97316', text: '#431407', label: '?' },
  blunder:   { bg: '#ef4444', text: '#fff', label: '??' },
}

const NAG_SYMBOL: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' }

function MoveBadge({ move, active, onClick, small, nags }: {
  move: MoveAnalysis
  active: boolean
  onClick: () => void
  small?: boolean
  nags?: number[]
}) {
  const cls = move.isAnalyzed ? CLASS_COLORS[move.classification] : null
  const annotation = (nags ?? []).map((n) => NAG_SYMBOL[n]).filter(Boolean).join('')

  return (
    <button
      onClick={onClick}
      className={`
        relative rounded font-mono transition-all duration-150
        ${small ? 'px-1 py-0.5 text-xs' : 'px-2 py-1 text-sm'}
        ${active
          ? 'bg-[#388bfd] text-white font-semibold shadow-sm'
          : small ? 'text-[#9da7b3] hover:bg-[#21262d] hover:text-[#e6edf3]' : 'text-[#e6edf3] hover:bg-[#21262d]'
        }
      `}
    >
      {annotation && <span className="sr-only">anotado</span>}
      {move.san}
      {annotation && <span className="ml-px text-[#e6edf3]/80">{annotation}</span>}
      {cls && move.isAnalyzed && (
        <span
          className="ml-0.5 text-[9px] font-bold"
          style={{ color: active ? '#fff' : cls.bg }}
        >
          {cls.label}
        </span>
      )}
      {move.isAnalyzed && move.isCritical && (
        <span
          className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-orange-500"
          title="Momento crítico"
        />
      )}
      {move.isAnalyzing && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
      )}
    </button>
  )
}

const btn =
  'px-2 py-0.5 rounded border border-[#30363d] text-[10px] text-[#7d8590] hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors'

/**
 * The whole game tree: main line with move numbers, each set of variations on its own
 * indented row right after the move they replace, nested variations inline in parentheses.
 * Click any move to jump there; a bar offers "back to main line / promote / delete" when
 * the cursor is inside a variation.
 */
export default function MoveList() {
  const { tree, rootId, cursorId, isOnMainline, selectNode, backToMainline, promoteVariation, deleteVariation } = useGame()
  const activeRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the active move visible inside the list (without scrolling the whole page).
  useEffect(() => {
    const box = scrollRef.current
    const el = activeRef.current
    if (!box || !el) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3
  }, [cursorId])

  if (!tree[rootId]?.children.length) {
    return (
      <div className="text-center text-[#7d8590] text-sm py-6">
        Faça um lance ou carregue um PGN para começar
      </div>
    )
  }

  const numberLabel = (id: string, force: boolean) => {
    const parentFen = tree[tree[id].parentId!].fen
    const [, side, , , , full] = parentFen.split(' ')
    if (side === 'w') return `${full}.`
    return force ? `${full}…` : null
  }

  const moveEl = (id: string, force: boolean, small: boolean) => {
    const n = tree[id]
    const label = numberLabel(id, force)
    return (
      <span key={id} className="inline-flex items-center">
        {label && (
          <span className={`text-[#7d8590] font-mono shrink-0 text-right ${small ? 'text-[10px] pr-0.5' : 'text-xs w-7 pr-1'}`}>
            {label}
          </span>
        )}
        <span ref={cursorId === id ? activeRef : null}>
          <MoveBadge move={n.move!} nags={n.nags} active={cursorId === id} onClick={() => selectNode(id)} small={small} />
        </span>
        {n.comment && (
          <span className={`text-[#7d8590] italic px-1 ${small ? 'text-[10px]' : 'text-[11px]'}`}>{n.comment}</span>
        )}
      </span>
    )
  }

  /** A line starting after `fromId`; variations nested inside (depth >= 1) render inline. */
  const renderLine = (fromId: string, depth: number, forceFirst: boolean): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    let p = fromId
    let force = forceFirst
    while (tree[p].children.length) {
      const [main, ...vars] = tree[p].children
      out.push(moveEl(main, force, depth > 0))
      force = false
      if (vars.length) {
        const variations = vars.map((v) => (
          <span key={`var-${v}`} className="inline-flex flex-wrap items-center">
            <span className="text-[#484f58] text-xs">(</span>
            {moveEl(v, true, true)}
            {renderLine(v, depth + 1, false)}
            <span className="text-[#484f58] text-xs">)</span>
          </span>
        ))
        out.push(
          depth === 0 ? (
            <div key={`vars-${p}`} className="basis-full flex flex-col gap-0.5 pl-6 my-0.5 border-l-2 border-[#30363d] ml-3">
              {variations.map((v, i) => (
                <div key={i} className="flex flex-wrap items-center">{v}</div>
              ))}
            </div>
          ) : (
            variations
          ),
        )
        force = true // main line resumes after variations: repeat the move number
      }
      p = main
    }
    return out
  }

  return (
    <div className="space-y-2">
      {!isOnMainline && (
        <div className="flex items-center gap-1.5 flex-wrap rounded-md bg-[#388bfd]/10 border border-[#388bfd]/30 px-2 py-1.5">
          <span className="text-[11px] text-[#79c0ff] mr-auto">Você está numa variante</span>
          <button onClick={backToMainline} className={btn} title="Voltar ao ponto onde esta variante saiu da linha principal">
            ↩ Linha principal
          </button>
          <button onClick={() => promoteVariation(cursorId)} className={btn} title="Tornar esta variante a linha principal">
            ⬆ Promover
          </button>
          <button
            onClick={() => {
              // Delete the whole variation: from the move where it leaves the main line.
              const path: string[] = []
              for (let id: string | null = cursorId; id; id = tree[id].parentId) path.unshift(id)
              const branch = path.find((id, i) => i > 0 && tree[path[i - 1]].children[0] !== id) ?? cursorId
              deleteVariation(branch)
            }}
            className={btn}
            title="Apagar esta variante"
          >
            🗑 Apagar
          </button>
        </div>
      )}
      {tree[rootId].comment && <p className="text-[11px] text-[#7d8590] italic">{tree[rootId].comment}</p>}
      <div ref={scrollRef} className="overflow-y-auto max-h-56 scrollbar-hide">
        <div className="flex flex-wrap items-center gap-y-0.5">{renderLine(rootId, 0, true)}</div>
      </div>
    </div>
  )
}
