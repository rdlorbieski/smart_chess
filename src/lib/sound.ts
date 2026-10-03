// Move sounds synthesized with Web Audio (no audio files to ship). The on/off choice is a
// per-browser convenience, so localStorage is fine; every access is guarded.

const KEY = 'chessmind.sound'
let ctx: AudioContext | null = null
const listeners = new Set<(on: boolean) => void>()

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* private mode: keep it for this session only */
  }
  listeners.forEach((fn) => fn(on))
}

export function onSoundChange(fn: (on: boolean) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

function tone(freq: number, start: number, dur: number, gain: number, type: OscillatorType = 'triangle') {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(gain, ctx.currentTime + start)
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur)
  osc.connect(g).connect(ctx.destination)
  osc.start(ctx.currentTime + start)
  osc.stop(ctx.currentTime + start + dur + 0.02)
}

export type MoveSound = 'move' | 'capture' | 'check' | 'castle' | 'promote' | 'end'

/** Classify a SAN move into a sound. */
export function soundForSan(san: string): MoveSound {
  if (san.includes('#')) return 'end'
  if (san.includes('+')) return 'check'
  if (san.includes('=')) return 'promote'
  if (san.startsWith('O-O')) return 'castle'
  if (san.includes('x')) return 'capture'
  return 'move'
}

export function playSound(kind: MoveSound) {
  if (!soundEnabled()) return
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    return
  }
  switch (kind) {
    case 'move':
      tone(420, 0, 0.07, 0.18)
      break
    case 'capture':
      tone(300, 0, 0.06, 0.25, 'square')
      tone(220, 0.05, 0.09, 0.2, 'square')
      break
    case 'castle':
      tone(420, 0, 0.06, 0.18)
      tone(420, 0.09, 0.06, 0.18)
      break
    case 'check':
      tone(660, 0, 0.09, 0.2)
      tone(880, 0.08, 0.12, 0.18)
      break
    case 'promote':
      tone(520, 0, 0.08, 0.18)
      tone(780, 0.08, 0.14, 0.18)
      break
    case 'end':
      tone(523, 0, 0.12, 0.2)
      tone(659, 0.1, 0.12, 0.2)
      tone(784, 0.2, 0.25, 0.2)
      break
  }
}
