import { Chess } from 'chess.js'
import type { Color } from '../types'

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const START: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 }
const ORDER = ['q', 'r', 'b', 'n', 'p'] as const

export interface MaterialInfo {
  /** Pieces this side has captured (i.e. the opponent's missing pieces), strongest first. */
  captured: string[]
  /** Material lead in pawns for this side (0 when behind or level). */
  lead: number
}

/**
 * Captured pieces and material lead derived from the board alone. Promotions are counted
 * correctly: a promoted queen cancels the "missing pawn" instead of showing a phantom capture.
 */
export function materialFor(fen: string): Record<Color, MaterialInfo> {
  const board = new Chess(fen).board()
  const count: Record<Color, Record<string, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0 },
  }
  for (const row of board) for (const sq of row) if (sq && sq.type !== 'k') count[sq.color][sq.type]++

  const score = (c: Color) => ORDER.reduce((a, t) => a + count[c][t] * VALUE[t], 0)
  const missing = (c: Color) => {
    const out: string[] = []
    for (const t of ORDER) for (let i = 0; i < Math.max(0, START[t] - count[c][t]); i++) out.push(t)
    return out
  }
  const diff = score('w') - score('b')
  return {
    // White captured black's missing pieces, and vice versa.
    w: { captured: missing('b'), lead: Math.max(0, diff) },
    b: { captured: missing('w'), lead: Math.max(0, -diff) },
  }
}

const GLYPH: Record<Color, Record<string, string>> = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' },
}

/** Glyphs for the pieces `by` has captured (they are the opponent's color). */
export const capturedGlyphs = (pieces: string[], by: Color) =>
  pieces.map((t) => GLYPH[by === 'w' ? 'b' : 'w'][t])
