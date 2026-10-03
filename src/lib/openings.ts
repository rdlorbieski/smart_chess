export interface Opening {
  eco: string
  name: string
}

type Book = Record<string, [string, string]>

let book: Book | null = null
let loading: Promise<Book> | null = null

const epd = (fen: string) => fen.split(' ').slice(0, 4).join(' ')

/** Lazy-loads the ECO book (~450 KB) so it stays out of the main bundle. */
export function loadOpenings(): Promise<Book> {
  loading ??= import('../data/openings.json').then((m) => (book = m.default as unknown as Book))
  return loading
}

/**
 * Deepest known opening reached in fens[0..upTo]. Matching by position (not by move
 * string) makes it work across transpositions and for PGNs written in any move order.
 */
export function findOpening(fens: string[], upTo: number): Opening | null {
  if (!book) return null
  for (let i = Math.min(upTo, fens.length - 1); i >= 0; i--) {
    const hit = book[epd(fens[i])]
    if (hit) return { eco: hit[0], name: hit[1] }
  }
  return null
}
