/** "23." when White is to move in `fen`, "23…" when Black is. */
export function moveNumberLabel(fen: string) {
  const [, turn, , , , full] = fen.split(' ')
  return `${Number(full) || 1}${turn === 'w' ? '.' : '…'}`
}

/**
 * SAN moves played from `fen` with their move numbers attached where they belong:
 * ["23.Nd4", "Rxc1+", "24.Rxc1", "Bxd4"], or ["23…Rxc1+", "24.Rxc1", …] for Black first.
 */
export function numberedTokens(sans: string[], fen: string) {
  const [, turn, , , , full] = fen.split(' ')
  let n = Number(full) || 1
  let white = turn === 'w'
  return sans.map((san, i) => {
    const token = white ? `${n}.${san}` : i === 0 ? `${n}…${san}` : san
    if (!white) n++
    white = !white
    return token
  })
}

/** "14.Rb1 b4 15.Nb5 …" — at most `max` moves. */
export function numberedLine(sans: string[], fen: string, max: number) {
  return numberedTokens(sans.slice(0, max), fen).join(' ') + (sans.length > max ? ' …' : '')
}
