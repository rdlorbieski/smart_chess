import { useEffect, useRef } from 'react'
import type { MoveAnalysis, MoveClassification } from '../types'
import { useGame } from '../store/GameContext'

/** Classifications worth an icon next to the move (the rest stay clean, like chess.com). */
const CLASS_ICONS: Partial<Record<MoveClassification, { bg: string; label: string; title: string }>> = {
  brilliant: { bg: '#26c2a3', label: '!!', title: 'Brilhante' },
  great: { bg: '#5c8bb0', label: '!', title: 'Ótimo lance' },
  inaccuracy: { bg: '#f7c631', label: '?!', title: 'Imprecisão' },
  mistake: { bg: '#e58f2a', label: '?', title: 'Erro' },
  blunder: { bg: '#ca3431', label: '??', title: 'Erro grave' },
}

const NAG_SYMBOL: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' }

const FIGURINES: Record<string, string> = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }
/** "Nf3" → "♘f3": figurines read the same in any language. */
export const figurine = (san: string) => (FIGURINES[san[0]] ? FIGURINES[san[0]] + san.slice(1) : san)

function MoveBadge({ move, active, onClick, small, nags }: {
  move: MoveAnalysis
  active: boolean
  onClick: () => void
  small?: boolean
  nags?: number[]
}) {
  const icon = move.isAnalyzed ? CLASS_ICONS[move.classification] : undefined
  const annotation = (nags ?? []).map((n) => NAG_SYMBOL[n]).filter(Boolean).join('')

  return (
    <button
      onClick={onClick}
      className={`
        relative inline-flex items-center gap-1 rounded-[3px] transition-colors
        ${small ? 'px-1 py-px text-[11px]' : 'px-1.5 py-0.5 text-[13px] font-semibold'}
        ${active
          ? 'bg-[#4a5b75] text-white'
          : small ? 'text-[#a3afc2] hover:bg-[#2a3648] hover:text-[#f1f4f8]' : 'text-[#d5dbe5] hover:bg-[#2a3648]'
        }
      `}
    >
      {icon && !small && (
        <span
          className="w-[15px] h-[15px] shrink-0 rounded-full flex items-center justify-center text-[8px] font-black text-white leading-none"
          style={{ backgroundColor: icon.bg }}
          title={icon.title}
        >
          {icon.label}
        </span>
      )}
      <span>{figurine(move.san)}</span>
      {annotation && <span className="text-[#f1f4f8]/80">{annotation}</span>}
      {icon && small && <span className="text-[9px] font-bold" style={{ color: icon.bg }}>{icon.label}</span>}
      {move.isAnalyzed && move.isOnlyMove && !small && (
        <span className="text-[9px] text-amber-400" title="Lance único: só ele mantinha a avaliação">◆</span>
      )}
      {move.isAnalyzed && move.isCritical && (
        <span
          className="absolute -bottom-px left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-orange-500"
          title="Momento crítico"
        />
      )}
      {move.isAnalyzing && (
        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[#81b64c] animate-pulse" />
      )}
    </button>
  )
}

const btn =
  'px-2 py-0.5 rounded border border-[#34435a] text-[10px] text-[#8f9db3] hover:bg-[#2a3648] hover:text-[#f1f4f8] transition-colors'

interface Row {
  num: number
  white: string | null // null = "…" (the row continues after variations)
  black?: string
}

/**
 * The whole game tree. The main line is a chess.com-style table (number | White | Black);
 * variations sit indented right after the move they replace, nested ones inline in
 * parentheses. A bar offers "back to main line / promote / delete" inside a variation.
 */
export default function MoveList({ fill = false }: { fill?: boolean }) {
  const { tree, rootId, cursorId, isOnMainline, selectNode, backToMainline, promoteVariation, deleteVariation } = useGame()
  const activeRef = useRef<HTMLSpanElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the active move visible inside the list (without scrolling the whole page), also
  // when the list box shrinks or grows because the panel above it changed height.
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const reveal = () => {
      const el = activeRef.current
      if (!el) return
      const b = box.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3
    }
    reveal()
    const ro = new ResizeObserver(reveal)
    ro.observe(box)
    return () => ro.disconnect()
  }, [cursorId])

  if (!tree[rootId]?.children.length) {
    return (
      <div className="text-center text-[#8f9db3] text-sm py-6">
        Faça um lance ou carregue um PGN para começar
      </div>
    )
  }

  const sideAndNumber = (id: string) => {
    const [, side, , , , full] = tree[tree[id].parentId!].fen.split(' ')
    return { side, num: Number(full) }
  }

  const moveEl = (id: string, force: boolean, small: boolean) => {
    const n = tree[id]
    const { side, num } = sideAndNumber(id)
    const label = side === 'w' ? `${num}.` : force ? `${num}…` : null
    return (
      <span key={id} className="inline-flex items-center">
        {small && label && <span className="text-[#5f6d83] text-[10px] pr-0.5">{label}</span>}
        <span ref={cursorId === id ? activeRef : null}>
          <MoveBadge move={n.move!} nags={n.nags} active={cursorId === id} onClick={() => selectNode(id)} small={small} />
        </span>
        {n.comment && (
          <span className={`text-[#8f9db3] italic px-1 ${small ? 'text-[10px]' : 'text-[11px]'}`}>{n.comment}</span>
        )}
      </span>
    )
  }

  /** A line starting after `fromId`, inline (used inside variations). */
  const renderLine = (fromId: string, forceFirst: boolean): React.ReactNode[] => {
    const out: React.ReactNode[] = []
    let p = fromId
    let force = forceFirst
    while (tree[p].children.length) {
      const [main, ...vars] = tree[p].children
      out.push(moveEl(main, force, true))
      force = false
      for (const v of vars) {
        out.push(
          <span key={`var-${v}`} className="inline-flex flex-wrap items-center">
            <span className="text-[#5f6d83] text-xs">(</span>
            {moveEl(v, true, true)}
            {renderLine(v, false)}
            <span className="text-[#5f6d83] text-xs">)</span>
          </span>,
        )
        force = true
      }
      p = main
    }
    return out
  }

  // Main line as table rows, broken wherever a move has alternatives.
  const blocks: React.ReactNode[] = []
  let row: Row | null = null
  let rowIndex = 0
  const flush = () => {
    if (!row) return
    const r = row
    const cell = (id: string | null | undefined) =>
      id === null ? <span className="px-1.5 text-[#5f6d83]">…</span> : id ? moveEl(id, false, false) : null
    blocks.push(
      <div
        key={`row-${r.white ?? 'x'}-${r.black ?? 'x'}-${rowIndex}`}
        className={`grid grid-cols-[40px_1fr_1fr] items-center px-2 py-[3px] ${rowIndex % 2 ? 'bg-[#243042]' : ''}`}
      >
        <span className="text-[#5f6d83] text-[12px] pl-1">{r.num}.</span>
        <div>{cell(r.white)}</div>
        <div>{cell(r.black)}</div>
      </div>,
    )
    rowIndex++
    row = null
  }

  let p = rootId
  while (tree[p].children.length) {
    const [id, ...vars] = tree[p].children
    const { side, num } = sideAndNumber(id)
    if (side === 'w') {
      flush()
      row = { num, white: id }
    } else {
      row ??= { num, white: null }
      row.black = id
    }
    if (vars.length) {
      flush()
      blocks.push(
        <div key={`vars-${p}`} className="flex flex-col gap-0.5 my-1 ml-6 mr-2 pl-2 border-l-2 border-[#34435a]">
          {vars.map((v) => (
            <div key={v} className="flex flex-wrap items-center">
              {moveEl(v, true, true)}
              {renderLine(v, false)}
            </div>
          ))}
        </div>,
      )
      if (side === 'w') row = { num, white: null }
    } else if (side === 'b') flush()
    p = id
  }
  flush()

  return (
    <div className={`flex flex-col min-h-0 ${fill ? 'flex-1' : ''}`}>
      {!isOnMainline && (
        <div className="flex items-center gap-1.5 flex-wrap bg-[#81b64c]/10 border-y border-[#81b64c]/30 px-3 py-1.5">
          <span className="text-[11px] text-[#a7d58a] mr-auto">Você está numa variante</span>
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
      {tree[rootId].comment && <p className="px-3 py-1 text-[11px] text-[#8f9db3] italic">{tree[rootId].comment}</p>}
      <div ref={scrollRef} className={`overflow-y-auto ${fill ? 'flex-1 min-h-[120px] max-h-80 xl:max-h-none' : 'max-h-72'}`}>
        {blocks}
      </div>
    </div>
  )
}
