import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { Chess } from 'chess.js'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.CHESS_DB ?? path.join(root, 'data', 'games.db')
mkdirSync(path.dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS games (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    white      TEXT NOT NULL DEFAULT 'White',
    black      TEXT NOT NULL DEFAULT 'Black',
    event      TEXT NOT NULL DEFAULT '',
    site       TEXT NOT NULL DEFAULT '',
    game_date  TEXT NOT NULL DEFAULT '',
    result     TEXT NOT NULL DEFAULT '*',
    pgn        TEXT,
    fen        TEXT,
    notes      TEXT NOT NULL DEFAULT '',
    stars      INTEGER NOT NULL DEFAULT 0 CHECK (stars BETWEEN 0 AND 5),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK (pgn IS NOT NULL OR fen IS NOT NULL)
  );
  CREATE INDEX IF NOT EXISTS idx_games_event ON games(event);
  CREATE INDEX IF NOT EXISTS idx_games_stars ON games(stars DESC);
`)

// Migration for databases created before the opening columns existed.
const cols = db.prepare('PRAGMA table_info(games)').all().map((c) => c.name)
if (!cols.includes('eco')) db.exec("ALTER TABLE games ADD COLUMN eco TEXT NOT NULL DEFAULT ''")
if (!cols.includes('opening')) db.exec("ALTER TABLE games ADD COLUMN opening TEXT NOT NULL DEFAULT ''")
db.exec('CREATE INDEX IF NOT EXISTS idx_games_eco ON games(eco)')
// source: 'user' = saved from the app, 'import' = bulk-imported database (e.g. TWIC / master games).
if (!cols.includes('source')) db.exec("ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'user'")
if (!cols.includes('white_elo')) db.exec('ALTER TABLE games ADD COLUMN white_elo INTEGER')
if (!cols.includes('black_elo')) db.exec('ALTER TABLE games ADD COLUMN black_elo INTEGER')
if (!cols.includes('hash')) db.exec('ALTER TABLE games ADD COLUMN hash TEXT')
db.exec('CREATE INDEX IF NOT EXISTS idx_games_source ON games(source)')
db.exec('CREATE INDEX IF NOT EXISTS idx_games_hash ON games(hash)')

// Position index powering the explorer: one row per position reached in each saved game.
db.exec(`
  CREATE TABLE IF NOT EXISTS game_positions (
    game_id  INTEGER NOT NULL,
    epd      TEXT NOT NULL,
    ply      INTEGER NOT NULL,
    next_san TEXT,
    PRIMARY KEY (game_id, ply)
  );
  CREATE INDEX IF NOT EXISTS idx_positions_epd ON game_positions(epd);
`)

const epd = (fen) => fen.split(' ').slice(0, 4).join(' ')

const insertPosition = db.prepare('INSERT OR REPLACE INTO game_positions (game_id, epd, ply, next_san) VALUES (?, ?, ?, ?)')

/** Indexes the main line of an already-parsed game (no transaction of its own). */
function indexParsed(id, parsed) {
  const headers = parsed.getHeaders()
  const history = parsed.history()
  const replay = headers.SetUp === '1' && headers.FEN ? new Chess(headers.FEN) : new Chess()
  history.forEach((san, ply) => {
    insertPosition.run(id, epd(replay.fen()), ply, san)
    replay.move(san)
  })
  insertPosition.run(id, epd(replay.fen()), history.length, null)
}

function inTransaction(fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

function indexGame(id, pgn) {
  const parsed = new Chess()
  try {
    parsed.loadPgn(pgn)
  } catch {
    return
  }
  inTransaction(() => indexParsed(id, parsed))
}

// Backfill games saved before the explorer existed.
for (const g of db
  .prepare('SELECT id, pgn FROM games WHERE pgn IS NOT NULL AND id NOT IN (SELECT DISTINCT game_id FROM game_positions)')
  .all()) {
  indexGame(g.id, g.pgn)
}

const text = (v, max) => String(v ?? '').trim().slice(0, max)

export function saveGame(input) {
  const pgn = text(input.pgn, 200_000) || null
  const fen = text(input.fen, 200) || null
  if (!pgn && !fen) throw new Error('pgn or fen required')
  const result = ['1-0', '0-1', '1/2-1/2', '*'].includes(input.result) ? input.result : '*'
  const stars = Math.min(5, Math.max(0, Math.round(Number(input.stars) || 0)))
  const info = db
    .prepare(
      `INSERT INTO games (white, black, event, site, game_date, result, pgn, fen, notes, stars, eco, opening)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      text(input.white, 100) || 'White',
      text(input.black, 100) || 'Black',
      text(input.event, 200),
      text(input.site, 200),
      text(input.date, 20),
      result,
      pgn,
      fen,
      text(input.notes, 5000),
      stars,
      text(input.eco, 10),
      text(input.opening, 200),
    )
  const id = Number(info.lastInsertRowid)
  if (pgn) indexGame(id, pgn)
  return id
}

const RESULTS = ['1-0', '0-1', '1/2-1/2', '*']
const elo = (v) => (/^\d{3,4}$/.test(String(v ?? '')) ? Number(v) : null)

/**
 * Bulk import of a PGN file (many games). Games are stored with source='import', indexed
 * for the explorer, and de-duplicated by a hash of players + date + moves. Unreadable
 * games are skipped, not fatal. Everything runs in one transaction (fast, all-or-nothing).
 */
export function importPgn(textIn) {
  const chunks = String(textIn).replace(/\r\n?/g, '\n').split(/\n(?=\[Event\s)/)
  const insert = db.prepare(
    `INSERT INTO games (white, black, event, site, game_date, result, pgn, eco, opening, source, white_elo, black_elo, hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)`,
  )
  const exists = db.prepare('SELECT 1 FROM games WHERE hash = ? LIMIT 1')
  let imported = 0
  let duplicates = 0
  let skipped = 0
  inTransaction(() => {
    for (const raw of chunks) {
      const pgn = raw.trim()
      if (!pgn) continue
      const parsed = new Chess()
      try {
        parsed.loadPgn(pgn)
      } catch {
        skipped++
        continue
      }
      const h = parsed.getHeaders()
      const moves = parsed.history().join(' ')
      if (!moves) {
        skipped++
        continue
      }
      const hash = createHash('sha1').update(`${h.White}|${h.Black}|${h.Date}|${moves}`).digest('hex')
      if (exists.get(hash)) {
        duplicates++
        continue
      }
      const info = insert.run(
        text(h.White, 100) || 'White',
        text(h.Black, 100) || 'Black',
        text(h.Event, 200),
        text(h.Site, 200),
        text(h.Date, 20),
        RESULTS.includes(h.Result) ? h.Result : '*',
        pgn.slice(0, 200_000),
        text(h.ECO, 10),
        text(h.Opening, 200),
        elo(h.WhiteElo),
        elo(h.BlackElo),
        hash,
      )
      indexParsed(Number(info.lastInsertRowid), parsed)
      imported++
    }
  })
  return { imported, duplicates, skipped }
}

export function databaseStats() {
  return db.prepare("SELECT source, COUNT(*) AS games FROM games GROUP BY source").all()
}

/** Removes every bulk-imported game (user-saved games are kept). */
export function clearImported() {
  return inTransaction(() => {
    db.prepare("DELETE FROM game_positions WHERE game_id IN (SELECT id FROM games WHERE source = 'import')").run()
    return db.prepare("DELETE FROM games WHERE source = 'import'").run().changes
  })
}

export function listGames(q = '') {
  const like = `%${text(q, 100).replace(/[\\%_]/g, '\\$&')}%`
  return db
    .prepare(
      `SELECT id, white, black, event, site, game_date, result, stars, notes, created_at, eco, opening,
              pgn IS NOT NULL AS has_pgn
         FROM games
        WHERE source = 'user'
          AND (white LIKE ?1 ESCAPE '\\' OR black LIKE ?1 ESCAPE '\\'
           OR event LIKE ?1 ESCAPE '\\' OR notes LIKE ?1 ESCAPE '\\'
           OR opening LIKE ?1 ESCAPE '\\' OR eco LIKE ?1 ESCAPE '\\')
        ORDER BY stars DESC, id DESC LIMIT 500`,
    )
    .all(like)
}

export const getGame = (id) => db.prepare('SELECT * FROM games WHERE id = ?').get(id) ?? null
export function deleteGame(id) {
  db.prepare('DELETE FROM game_positions WHERE game_id = ?').run(id)
  return db.prepare('DELETE FROM games WHERE id = ?').run(id).changes > 0
}

/** Moves played from a position across saved games (with results) plus the games that reached it. */
export function explore(fen, source = 'user') {
  const key = epd(String(fen))
  const src = source === 'import' ? 'import' : 'user'
  const moves = db
    .prepare(
      `SELECT p.next_san AS san, COUNT(DISTINCT p.game_id) AS count,
              SUM(g.result = '1-0') AS white, SUM(g.result = '1/2-1/2') AS draws, SUM(g.result = '0-1') AS black
         FROM game_positions p JOIN games g ON g.id = p.game_id
        WHERE p.epd = ? AND p.next_san IS NOT NULL AND g.source = ?
        GROUP BY p.next_san ORDER BY count DESC LIMIT 30`,
    )
    .all(key, src)
  const games = db
    .prepare(
      `SELECT g.id, g.white, g.black, g.event, g.game_date, g.result, g.stars, g.white_elo, g.black_elo,
              MIN(p.ply) AS ply
         FROM game_positions p JOIN games g ON g.id = p.game_id
        WHERE p.epd = ? AND g.source = ?
        GROUP BY g.id
        ORDER BY g.stars DESC, MAX(COALESCE(g.white_elo, 0), COALESCE(g.black_elo, 0)) DESC, g.id DESC
        LIMIT 30`,
    )
    .all(key, src)
  return { moves, games }
}
