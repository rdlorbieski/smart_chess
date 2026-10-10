import { useEffect, useState } from 'react'
import { useGame } from '../store/GameContext'
import { findOpening, loadOpenings } from '../lib/openings'

/** Name of the opening for the current position (deepest book match so far). */
export default function OpeningBadge() {
  const { fens, currentIndex } = useGame()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    loadOpenings().then(() => setReady(true)).catch(() => {})
  }, [])

  const opening = ready ? findOpening(fens, currentIndex) : null
  if (!opening) return null

  return (
    <span className="flex items-center gap-1.5 min-w-0 text-xs" title={`${opening.eco} · ${opening.name}`}>
      <span className="font-mono font-semibold text-[#81b64c] shrink-0">{opening.eco}</span>
      <span className="text-[#f1f4f8] truncate">{opening.name}</span>
    </span>
  )
}
