import { useState, useRef, useEffect } from 'react'
import { formatClock } from '../store/useChessClock'

interface Props {
  name: string
  color: 'white' | 'black'
  isActive: boolean          // it's this player's turn
  onRename: (name: string) => void
  clockMs?: number | null    // shown when the clock is enabled
  flagged?: boolean
  captured?: string[]        // glyphs of pieces this player has captured
  lead?: number              // material lead in pawns
}

export default function PlayerNameplate({ name, color, isActive, onRename, clockMs, flagged, captured, lead }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(name) }, [name])

  const commit = () => {
    setEditing(false)
    onRename(draft)
  }

  const startEdit = () => {
    setDraft(name)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  return (
    <div className="flex items-center gap-2 px-1 py-0.5 min-w-0">
      {/* Piece color dot */}
      <div
        className="shrink-0 w-3.5 h-3.5 rounded-full border"
        style={{
          background: color === 'white' ? '#f0f0f0' : '#1a1a1a',
          borderColor: color === 'white' ? '#888' : '#555',
          boxShadow: isActive ? `0 0 0 2px ${color === 'white' ? 'rgba(240,240,240,0.35)' : 'rgba(80,80,80,0.5)'}` : 'none',
        }}
      />

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setEditing(false); setDraft(name) }
          }}
          maxLength={32}
          className="flex-1 min-w-0 bg-transparent border-b border-[#388bfd] text-[#e6edf3] text-sm font-display font-semibold outline-none leading-none py-0.5"
          style={{ width: Math.max(80, draft.length * 8) }}
          autoFocus
        />
      ) : (
        <button
          onClick={startEdit}
          title="Clique para renomear"
          className="flex items-center gap-1.5 min-w-0 group"
        >
          <span
            className={`text-sm font-display font-semibold leading-none truncate transition-colors ${
              isActive ? 'text-[#e6edf3]' : 'text-[#7d8590]'
            } group-hover:text-[#e6edf3]`}
          >
            {name}
          </span>
          <svg
            className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
            width="11" height="11" viewBox="0 0 16 16" fill="currentColor"
            style={{ color: '#7d8590' }}
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.286Z" />
          </svg>
        </button>
      )}

      {((captured && captured.length > 0) || (lead ?? 0) > 0) && (
        <span className="flex items-center gap-1 text-[#7d8590] min-w-0" title="Peças capturadas">
          <span className="text-sm leading-none tracking-[-0.15em] truncate">{captured?.join('')}</span>
          {(lead ?? 0) > 0 && <span className="text-[11px] font-mono font-semibold">+{lead}</span>}
        </span>
      )}

      {clockMs != null ? (
        <span
          className={`ml-auto shrink-0 font-mono text-sm font-semibold px-2 py-0.5 rounded ${
            flagged
              ? 'bg-red-500/20 text-red-400'
              : isActive
              ? 'bg-[#e6edf3] text-[#0d1117]'
              : 'bg-[#21262d] text-[#7d8590]'
          } ${!flagged && clockMs < 10_000 && isActive ? '!bg-red-500 !text-white' : ''}`}
        >
          {flagged ? '0:00 ⚑' : formatClock(clockMs)}
        </span>
      ) : (
        isActive && !editing && (
          <span className="ml-auto shrink-0 w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-pulse" />
        )
      )}
    </div>
  )
}
