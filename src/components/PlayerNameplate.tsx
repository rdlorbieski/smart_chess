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
    <div className="flex items-center gap-2.5 py-1.5 min-w-0 h-12">
      {/* Avatar: a pawn silhouette in the player's colour (chess.com's default avatar) */}
      <div
        className={`shrink-0 w-9 h-9 rounded-[3px] flex items-end justify-center overflow-hidden ${
          isActive ? 'ring-2 ring-[#81b64c]' : ''
        }`}
        style={{ background: color === 'white' ? '#d9dce1' : '#3a3a3a' }}
      >
        <svg viewBox="0 0 32 32" width="30" height="30" fill={color === 'white' ? '#ffffff' : '#1c1c1c'}>
          <circle cx="16" cy="10" r="5.5" />
          <path d="M11.5 16h9l1.5 7h-12z" />
          <path d="M6 32c0-6 4.5-9 10-9s10 3 10 9z" />
        </svg>
      </div>
      <div className="flex flex-col min-w-0 gap-0.5">

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
          className="flex-1 min-w-0 bg-transparent border-b border-[#81b64c] text-[#f1f4f8] text-sm font-semibold outline-none leading-none py-0.5"
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
            className="text-sm font-semibold leading-none truncate text-[#f1f4f8]"
          >
            {name}
          </span>
          <svg
            className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity"
            width="11" height="11" viewBox="0 0 16 16" fill="currentColor"
            style={{ color: '#8f9db3' }}
          >
            <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.286Z" />
          </svg>
        </button>
      )}

      <span className="flex items-center gap-1 text-[#8f9db3] min-w-0 h-4" title="Peças capturadas">
        <span className="text-sm leading-none tracking-[-0.15em] truncate">{captured?.join('')}</span>
        {(lead ?? 0) > 0 && <span className="text-[11px] font-semibold">+{lead}</span>}
      </span>
      </div>

      {clockMs != null ? (
        <span
          className={`ml-auto shrink-0 font-mono text-xl font-bold px-3 py-1 rounded-[3px] min-w-[110px] text-right ${
            flagged
              ? 'bg-red-500/20 text-red-400'
              : isActive
              ? 'bg-[#f1f4f8] text-[#1a2230]'
              : 'bg-[#2a3648] text-[#8f9db3]'
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
