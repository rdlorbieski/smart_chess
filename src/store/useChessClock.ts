import { useCallback, useEffect, useRef, useState } from 'react'
import type { Color } from '../types'

export interface ClockPreset {
  label: string
  minutes: number
  incrementSec: number
}

export const CLOCK_PRESETS: ClockPreset[] = [
  { label: '1+0', minutes: 1, incrementSec: 0 },
  { label: '3+2', minutes: 3, incrementSec: 2 },
  { label: '5+0', minutes: 5, incrementSec: 0 },
  { label: '10+0', minutes: 10, incrementSec: 0 },
  { label: '15+10', minutes: 15, incrementSec: 10 },
]

export interface ClockState {
  enabled: boolean
  initialMs: number
  incrementMs: number
  w: number
  b: number
  running: Color | null
  flagged: Color | null
}

const OFF: ClockState = { enabled: false, initialMs: 0, incrementMs: 0, w: 0, b: 0, running: null, flagged: null }

/**
 * Optional chess clock. Remaining times are kept in state and advanced from wall-clock
 * deltas (not tick counts), so background-tab throttling does not skew the time.
 */
export function useChessClock() {
  const [clock, setClock] = useState<ClockState>(OFF)
  const lastTick = useRef(0)

  const configure = useCallback((preset: ClockPreset | null) => {
    if (!preset) return setClock(OFF)
    const ms = preset.minutes * 60_000
    setClock({ enabled: true, initialMs: ms, incrementMs: preset.incrementSec * 1000, w: ms, b: ms, running: null, flagged: null })
  }, [])

  const reset = useCallback(() => {
    setClock((c) => (c.enabled ? { ...c, w: c.initialMs, b: c.initialMs, running: null, flagged: null } : c))
  }, [])

  const start = useCallback((turn: Color) => {
    lastTick.current = Date.now()
    setClock((c) => (c.enabled && !c.flagged ? { ...c, running: turn } : c))
  }, [])

  const pause = useCallback(() => setClock((c) => (c.running ? { ...c, running: null } : c)), [])

  /** Call after a move by `mover`: adds the increment and hands the clock to the opponent. */
  const onMove = useCallback((mover: Color, gameOver: boolean) => {
    setClock((c) => {
      if (!c.running) return c
      const now = Date.now()
      const spent = now - lastTick.current
      lastTick.current = now
      const left = Math.max(0, c[mover] - spent) + c.incrementMs
      return { ...c, [mover]: left, running: gameOver ? null : mover === 'w' ? 'b' : 'w' }
    })
  }, [])

  const running = clock.running
  useEffect(() => {
    if (!running) return
    lastTick.current = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      const spent = now - lastTick.current
      lastTick.current = now
      setClock((c) => {
        if (c.running !== running) return c
        const left = Math.max(0, c[running] - spent)
        return left === 0
          ? { ...c, [running]: 0, running: null, flagged: running }
          : { ...c, [running]: left }
      })
    }, 100)
    return () => clearInterval(id)
  }, [running])

  return { clock, configure, reset, start, pause, onMove }
}

export function formatClock(ms: number): string {
  const total = Math.max(0, ms)
  const s = Math.floor(total / 1000)
  const m = Math.floor(s / 60)
  if (m === 0 && total < 20_000) return `0:${String(s).padStart(2, '0')}.${Math.floor((total % 1000) / 100)}`
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
