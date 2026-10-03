import { Chess } from 'chess.js'

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export interface GameMeta {
  event: string
  site: string
  date: string // YYYY.MM.DD
  round: string
}

export const todayPgnDate = () => new Date().toISOString().slice(0, 10).replace(/-/g, '.')

export const defaultMeta = (): GameMeta => ({ event: '', site: '', date: todayPgnDate(), round: '' })

/** Result token from the final position (or a flagged clock). */
export function gameResult(finalFen: string, flagged?: 'w' | 'b' | null): '1-0' | '0-1' | '1/2-1/2' | '*' {
  if (flagged) return flagged === 'w' ? '0-1' : '1-0'
  const chess = new Chess(finalFen)
  if (chess.isCheckmate()) return chess.turn() === 'w' ? '0-1' : '1-0'
  if (chess.isDraw() || chess.isStalemate()) return '1/2-1/2'
  return '*'
}

/** Wraps movetext (with variations) in a PGN with headers; SetUp/FEN when the game starts from a custom position. */
export function buildPgn(opts: {
  mainlineFens: string[]
  movetext: string
  white: string
  black: string
  meta: GameMeta
  flagged?: 'w' | 'b' | null
  opening?: { eco: string; name: string } | null
}): { pgn: string; result: string } {
  const startFen = opts.mainlineFens[0]
  const result = gameResult(opts.mainlineFens[opts.mainlineFens.length - 1], opts.flagged)
  const headers: [string, string][] = [
    ['Event', opts.meta.event || 'Casual game'],
    ['Site', opts.meta.site || '?'],
    ['Date', opts.meta.date || '????.??.??'],
    ['Round', opts.meta.round || '-'],
    ['White', opts.white],
    ['Black', opts.black],
    ['Result', result],
  ]
  if (opts.opening) headers.push(['ECO', opts.opening.eco], ['Opening', opts.opening.name])
  if (startFen !== STARTING_FEN) headers.push(['SetUp', '1'], ['FEN', startFen])
  const head = headers.map(([k, v]) => `[${k} "${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n')
  return { pgn: `${head}\n\n${[opts.movetext, result].filter(Boolean).join(' ')}\n`, result }
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
