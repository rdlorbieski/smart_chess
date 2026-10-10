import { useCallback, useEffect, useState } from 'react'
import { useGame } from '../store/GameContext'
import { findOpening, loadOpenings } from '../lib/openings'
import {
  clearImportedDatabase,
  databaseStats,
  deleteGame,
  getGame,
  importPgnDatabase,
  listGames,
  saveGame,
  type SavedGameSummary,
} from '../api/games'

/**
 * Bulk import of PGN files (e.g. TWIC weekly issues, Lichess Elite) into a local master
 * database that the Explorer searches by position. Stored separately from your games.
 */
function DatabaseImport() {
  const [count, setCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const refresh = () =>
    databaseStats()
      .then((s) => setCount(s.find((r) => r.source === 'import')?.games ?? 0))
      .catch(() => setCount(null))
  useEffect(() => {
    refresh()
  }, [])

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setMsg(null)
    let imported = 0
    let duplicates = 0
    let skipped = 0
    try {
      for (const f of Array.from(files)) {
        const r = await importPgnDatabase(await f.text())
        imported += r.imported
        duplicates += r.duplicates
        skipped += r.skipped
      }
      setMsg({ ok: true, text: `${imported} partidas importadas (${duplicates} duplicadas, ${skipped} ilegíveis ignoradas).` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'A importação falhou' })
    } finally {
      setBusy(false)
      refresh()
    }
  }

  const clear = async () => {
    if (!confirm('Remover todas as partidas importadas da base local? Suas partidas salvas são mantidas.')) return
    await clearImportedDatabase()
    setMsg(null)
    refresh()
  }

  if (count === null) return null // server offline: the list below already says so
  return (
    <div className="mb-3 rounded-lg border border-[#34435a] bg-[#1a2230] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-[#a3afc2]">
          <span className="text-[#f1f4f8] font-semibold">Base de mestres</span> · {count.toLocaleString('pt-BR')} partidas importadas
        </div>
        <div className="flex gap-1.5 shrink-0">
          <label className={`px-2.5 py-1 rounded text-xs cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : 'bg-[#81b64c] text-white hover:bg-[#95c95f]'}`}>
            {busy ? 'Importando…' : 'Importar PGN…'}
            <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
          </label>
          {count > 0 && (
            <button onClick={clear} className="px-2.5 py-1 rounded text-xs border border-[#34435a] text-[#8f9db3] hover:text-red-400">
              Limpar
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-[#8f9db3]">
        Fontes gratuitas: TWIC (theweekinchess.com, partidas de elite toda semana) ou a Lichess Elite Database. As partidas
        importadas alimentam a seção "Base importada" do Explorador e ficam fora desta lista.
      </p>
      {msg && <p className={`text-xs ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
    </div>
  )
}

const input =
  'w-full bg-[#1a2230] border border-[#34435a] rounded-lg px-3 py-2 text-[#f1f4f8] text-sm focus:outline-none focus:border-[#81b64c] placeholder-[#8f9db3]'
const labelCls = 'block text-[#8f9db3] text-[10px] uppercase tracking-wider mb-1'

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-[#212b3a] border border-[#34435a] rounded-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#f1f4f8] font-semibold">{title}</h2>
          <button onClick={onClose} className="text-[#8f9db3] hover:text-[#f1f4f8] text-lg">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <span className="inline-flex">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(value === n ? 0 : n)}
          className={`text-lg leading-none ${n <= value ? 'text-amber-400' : 'text-[#34435a]'} ${onChange ? 'hover:text-amber-300' : 'cursor-default'}`}
          aria-label={`${n} estrelas`}
        >
          ★
        </button>
      ))}
    </span>
  )
}

export function SaveGameModal({ onClose }: { onClose: () => void }) {
  const { fens, moves, currentFen, playerWhite, playerBlack, meta, setMeta, setPlayerName, getPgn, serverEngine } = useGame()
  const [event, setEvent] = useState(meta.event)
  const [site, setSite] = useState(meta.site)
  const [white, setWhite] = useState(playerWhite)
  const [black, setBlack] = useState(playerBlack)
  const [notes, setNotes] = useState('')
  const [stars, setStars] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const hasMoves = moves.length > 0
  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      setMeta({ event, site })
      setPlayerName('white', white)
      setPlayerName('black', black)
      await loadOpenings()
      const op = findOpening(fens, fens.length - 1)
      const base = { white, black, event, site, date: meta.date, notes, stars, eco: op?.eco, opening: op?.name }
      if (hasMoves) {
        // Build with the edited names so the stored PGN headers match the form.
        const { pgn, result } = getPgnWith(white, black, event, site)
        await saveGame({ ...base, result, pgn })
      } else {
        await saveGame({ ...base, result: '*', fen: currentFen })
      }
      setMsg({ ok: true, text: 'Partida salva.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível salvar' })
    } finally {
      setBusy(false)
    }
  }

  // getPgn() reads state that has not re-rendered yet, so patch the headers of its output.
  const getPgnWith = (w: string, b: string, ev: string, si: string) => {
    const { pgn, result } = getPgn()
    const set = (p: string, tag: string, v: string) => p.replace(new RegExp(`\\[${tag} "[^"]*"\\]`), `[${tag} "${v.replace(/"/g, "'")}"]`)
    let out = set(pgn, 'White', w || 'Brancas')
    out = set(out, 'Black', b || 'Pretas')
    out = set(out, 'Event', ev || 'Partida casual')
    out = set(out, 'Site', si || '?')
    return { pgn: out, result }
  }

  return (
    <Modal title="Salvar partida" onClose={onClose}>
      {!serverEngine ? (
        <p className="text-sm text-[#8f9db3]">
          O servidor está desligado, então não dá para salvar. Inicie com <code className="text-[#f1f4f8]">pnpm server</code> e abra esta janela de novo.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Brancas</label>
              <input className={input} value={white} onChange={(e) => setWhite(e.target.value)} maxLength={100} />
            </div>
            <div>
              <label className={labelCls}>Pretas</label>
              <input className={input} value={black} onChange={(e) => setBlack(e.target.value)} maxLength={100} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Torneio / evento</label>
              <input className={input} value={event} onChange={(e) => setEvent(e.target.value)} maxLength={200} placeholder="ex.: Campeonato do clube" />
            </div>
            <div>
              <label className={labelCls}>Local</label>
              <input className={input} value={site} onChange={(e) => setSite(e.target.value)} maxLength={200} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Notas</label>
            <textarea className={`${input} h-16 resize-none`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={labelCls + ' !mb-0'}>Avaliação</span>
              <Stars value={stars} onChange={setStars} />
            </div>
            <span className="text-[10px] text-[#8f9db3] font-mono">
              salva {hasMoves ? `PGN · ${moves.length} lances` : 'FEN (posição atual)'}
            </span>
          </div>
          {msg && <p className={`text-sm ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#34435a] text-[#8f9db3] text-sm hover:bg-[#2a3648]">
              {msg?.ok ? 'Fechar' : 'Cancelar'}
            </button>
            <button
              onClick={save}
              disabled={busy || msg?.ok}
              className="px-4 py-2 rounded-lg bg-[#81b64c] text-white text-sm font-medium hover:bg-[#95c95f] disabled:opacity-40"
            >
              Salvar
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function LibraryModal({ onClose }: { onClose: () => void }) {
  const { loadPGN, loadFEN, setPlayerName, setMeta } = useGame()
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<SavedGameSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    listGames(q)
      .then((r) => { setRows(r); setError(null) })
      .catch(() => setError('Servidor desligado — inicie com `pnpm server`.'))
  }, [q])

  useEffect(() => {
    const t = setTimeout(refresh, 200)
    return () => clearTimeout(t)
  }, [refresh])

  const open = async (id: number) => {
    const g = await getGame(id)
    if (g.pgn) await loadPGN(g.pgn)
    else if (g.fen) loadFEN(g.fen)
    setPlayerName('white', g.white)
    setPlayerName('black', g.black)
    setMeta({ event: g.event, site: g.site })
    onClose()
  }

  const remove = async (id: number) => {
    if (!confirm('Apagar esta partida salva?')) return
    await deleteGame(id)
    refresh()
  }

  return (
    <Modal title="Partidas salvas" onClose={onClose}>
      <DatabaseImport />
      <input className={`${input} mb-3`} placeholder="Buscar jogadores, torneio, abertura, notas…" value={q} onChange={(e) => setQ(e.target.value)} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {rows && rows.length === 0 && <p className="text-sm text-[#8f9db3] py-4 text-center">Nenhuma partida salva ainda.</p>}
      <ul className="space-y-1.5">
        {rows?.map((g) => (
          <li key={g.id} className="rounded-lg border border-[#34435a] bg-[#1a2230] p-2.5 flex items-center gap-3">
            <button onClick={() => open(g.id)} className="flex-1 min-w-0 text-left">
              <div className="text-sm text-[#f1f4f8] truncate">
                {g.white} <span className="text-[#8f9db3]">x</span> {g.black}
                <span className="ml-2 font-mono text-xs text-[#8f9db3]">{g.result}</span>
              </div>
              <div className="text-[11px] text-[#8f9db3] truncate">
                {[g.event, g.game_date, g.eco && `${g.eco} ${g.opening}`, g.has_pgn ? 'PGN' : 'FEN'].filter(Boolean).join(' · ')}
              </div>
            </button>
            <Stars value={g.stars} />
            <button onClick={() => remove(g.id)} className="text-[#8f9db3] hover:text-red-400 text-sm" title="Apagar">🗑</button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
