export interface SavedGameSummary {
  id: number
  white: string
  black: string
  event: string
  site: string
  game_date: string
  result: string
  stars: number
  notes: string
  created_at: string
  has_pgn: number
  eco: string
  opening: string
}

export interface SavedGame extends SavedGameSummary {
  pgn: string | null
  fen: string | null
}

export interface NewGame {
  white: string
  black: string
  event: string
  site: string
  date: string
  result: string
  pgn?: string
  fen?: string
  notes: string
  stars: number
  eco?: string
  opening?: string
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`)
  return body as T
}

export async function serverHealth(): Promise<{ ok: boolean; engine: string | null } | null> {
  try {
    return await json(await fetch('/api/health'))
  } catch {
    return null
  }
}

export const listGames = (q = '') =>
  fetch(`/api/games?q=${encodeURIComponent(q)}`).then((r) => json<SavedGameSummary[]>(r))

export const getGame = (id: number) => fetch(`/api/games/${id}`).then((r) => json<SavedGame>(r))

export const saveGame = (g: NewGame) =>
  fetch('/api/games', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(g),
  }).then((r) => json<{ id: number }>(r))

export const deleteGame = (id: number) =>
  fetch(`/api/games/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r))

export interface ExplorerResult {
  moves: { san: string; count: number; white: number; draws: number; black: number }[]
  games: {
    id: number
    white: string
    black: string
    event: string
    game_date: string
    result: string
    stars: number
    ply: number
    white_elo?: number | null
    black_elo?: number | null
  }[]
}

/** source 'user' = games you saved; 'import' = bulk-imported database. */
export const explore = (fen: string, source: 'user' | 'import' = 'user') =>
  fetch(`/api/explorer?fen=${encodeURIComponent(fen)}&source=${source}`).then((r) => json<ExplorerResult>(r))

// ── Lichess Masters (proxied by the server, which holds the token) ──────────────

export interface MastersResult {
  white: number
  draws: number
  black: number
  moves: { uci: string; san: string; averageRating: number; white: number; draws: number; black: number }[]
  topGames: {
    id: string
    uci: string
    winner: 'white' | 'black' | null
    white: { name: string; rating: number }
    black: { name: string; rating: number }
    year: number
    month?: string
  }[]
  opening?: { eco: string; name: string } | null
}

export type MastersResponse =
  | { status: 'ok'; data: MastersResult }
  | { status: 'token-required' | 'token-rejected' | 'rate-limited' | 'offline' | 'error'; message?: string }

export async function masters(fen: string): Promise<MastersResponse> {
  let res: Response
  try {
    res = await fetch(`/api/masters?fen=${encodeURIComponent(fen)}`)
  } catch {
    return { status: 'offline' }
  }
  if (res.ok) return { status: 'ok', data: (await res.json()) as MastersResult }
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (body.error === 'token-required' || body.error === 'token-rejected' || body.error === 'rate-limited') {
    return { status: body.error }
  }
  return { status: res.status === 502 || res.status === 504 ? 'offline' : 'error', message: body.error }
}

export const masterGamePgn = (id: string) =>
  fetch(`/api/masters/pgn/${id}`).then(async (r) => {
    if (!r.ok) throw new Error(`Could not load game (${r.status})`)
    return r.text()
  })

export const lichessTokenStatus = () =>
  fetch('/api/lichess-token').then((r) => json<{ configured: boolean; source: 'env' | 'file' | null }>(r))

export const saveLichessToken = (token: string) =>
  fetch('/api/lichess-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then((r) => json<{ configured: boolean }>(r))

export const deleteLichessToken = () =>
  fetch('/api/lichess-token', { method: 'DELETE' }).then((r) => json<{ configured: boolean }>(r))

// ── Local PGN database (bulk import) ───────────────────────────────────────────

export const importPgnDatabase = (pgnText: string) =>
  fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/x-chess-pgn' }, body: pgnText }).then((r) =>
    json<{ imported: number; duplicates: number; skipped: number }>(r),
  )

export const databaseStats = () => fetch('/api/database').then((r) => json<{ source: string; games: number }[]>(r))

export const clearImportedDatabase = () =>
  fetch('/api/database', { method: 'DELETE' }).then((r) => json<{ removed: number }>(r))
