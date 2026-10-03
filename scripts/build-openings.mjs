// Builds src/data/openings.json from the lichess chess-openings dataset (CC0).
// Usage: node scripts/build-openings.mjs
import { Chess } from 'chess.js'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master'
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ')

const out = {}
for (const file of ['a', 'b', 'c', 'd', 'e']) {
  const res = await fetch(`${BASE}/${file}.tsv`)
  if (!res.ok) throw new Error(`download failed: ${file}.tsv (${res.status})`)
  const [, ...rows] = (await res.text()).trim().split('\n')
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t')
    const chess = new Chess()
    chess.loadPgn(pgn)
    // Later (longer/more specific) entries win when two lines reach the same position.
    out[epd(chess.fen())] = [eco, name]
  }
}

mkdirSync('src/data', { recursive: true })
writeFileSync('src/data/openings.json', JSON.stringify(out))
console.log(`wrote ${Object.keys(out).length} positions`)
