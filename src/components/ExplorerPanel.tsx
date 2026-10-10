import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { useGame } from '../store/GameContext'
import { findOpening, loadOpenings } from '../lib/openings'
import {
  databaseStats,
  explore,
  getGame,
  lichessTokenStatus,
  masterGamePgn,
  masters,
  saveLichessToken,
  type ExplorerResult,
  type MastersResponse,
} from '../api/games'

function ResultBar({ w, d, b }: { w: number; d: number; b: number }) {
  const total = w + d + b || 1
  const pct = (n: number) => Math.round((n / total) * 100)
  return (
    <div
      className="flex h-3.5 w-full overflow-hidden rounded text-[9px] font-mono leading-[14px]"
      title={`Vitória das brancas ${pct(w)}% · empates ${pct(d)}% · vitória das pretas ${pct(b)}%`}
    >
      <div className="bg-[#f1f4f8] text-[#1a2230] text-center overflow-hidden" style={{ width: `${pct(w)}%` }}>{pct(w) >= 12 ? `${pct(w)}%` : ''}</div>
      <div className="bg-[#8f9db3] text-[#1a2230] text-center overflow-hidden" style={{ width: `${pct(d)}%` }}>{pct(d) >= 12 ? `${pct(d)}%` : ''}</div>
      <div className="bg-[#34435a] text-[#f1f4f8] text-center overflow-hidden" style={{ width: `${pct(b)}%` }}>{pct(b) >= 12 ? `${pct(b)}%` : ''}</div>
    </div>
  )
}

const Section = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3">
    <div className="flex items-center justify-between mb-2">
      <span className="text-[#8f9db3] text-[10px] uppercase tracking-wider">{title}</span>
      {right}
    </div>
    {children}
  </div>
)

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

/** Asks for the free Lichess token; the user types it, the server stores it. */
function TokenForm({ rejected, onSaved }: { rejected: boolean; onSaved: () => void }) {
  const [token, setToken] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    setErr(null)
    try {
      await saveLichessToken(token)
      setToken('')
      onSaved()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar'
      // 404 = the running server predates this feature.
      setErr(msg === 'not found' ? 'Seu servidor é uma versão antiga — pare-o, rode `pnpm server` de novo e tente outra vez.' : msg)
    }
  }
  return (
    <div className="space-y-2 text-xs text-[#a3afc2]">
      <p>
        {rejected ? 'O Lichess recusou o token salvo. ' : ''}A base de mestres (~2 milhões de partidas, 2200+) precisa de um token{' '}
        <b className="text-[#f1f4f8]">gratuito</b> do Lichess: crie um em{' '}
        <a className="text-[#81b64c] hover:underline" href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
          lichess.org/account/oauth/token
        </a>{' '}
        (sem marcar nenhuma permissão) e cole aqui. Ele fica só no seu servidor (<code>data/</code>).
      </p>
      <div className="flex gap-1.5">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="lip_…"
          autoComplete="off"
          className="flex-1 min-w-0 bg-[#1a2230] border border-[#34435a] rounded px-2 py-1 text-[#f1f4f8] focus:outline-none focus:border-[#81b64c]"
        />
        <button
          onClick={save}
          disabled={!token.trim()}
          className="px-3 py-1 rounded bg-[#81b64c] text-white disabled:opacity-40"
        >
          Salvar
        </button>
      </div>
      {err && <p className="text-red-400">{err}</p>}
    </div>
  )
}

/**
 * Explorer for the displayed position: masters (Lichess), your imported database,
 * the opening book, and your own saved games.
 */
export default function ExplorerPanel() {
  const { currentFen, fens, currentIndex, makeMove, loadPGN, serverEngine } = useGame()
  const [bookReady, setBookReady] = useState(false)
  const [master, setMaster] = useState<MastersResponse | null>(null)
  const [masterTick, setMasterTick] = useState(0)
  const [imported, setImported] = useState<ExplorerResult | null>(null)
  const [mine, setMine] = useState<ExplorerResult | null>(null)
  const [hasImports, setHasImports] = useState(false)
  const [failed, setFailed] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [hasToken, setHasToken] = useState<boolean | null>(null)

  useEffect(() => {
    loadOpenings().then(() => setBookReady(true)).catch(() => {})
  }, [])

  // Only query Lichess once a token is configured (avoids pointless 428 round-trips).
  useEffect(() => {
    if (!serverEngine) return
    lichessTokenStatus()
      .then((t) => setHasToken(t.configured))
      .catch(() => setHasToken(false))
  }, [serverEngine, masterTick])

  useEffect(() => {
    if (!serverEngine) return
    databaseStats()
      .then((s) => setHasImports(s.some((r) => r.source === 'import' && r.games > 0)))
      .catch(() => {})
  }, [serverEngine])

  // Lookups are debounced so quick navigation doesn't spam the server / Lichess.
  useEffect(() => {
    setMaster(null)
    setImported(null)
    setMine(null)
    setFailed(false)
    if (!serverEngine) return
    const t = setTimeout(() => {
      if (hasToken) masters(currentFen).then(setMaster)
      else if (hasToken === false) setMaster({ status: 'token-required' })
      if (hasImports) explore(currentFen, 'import').then(setImported).catch(() => setFailed(true))
      explore(currentFen, 'user').then(setMine).catch(() => setFailed(true))
    }, 300)
    return () => clearTimeout(t)
  }, [currentFen, serverEngine, hasImports, hasToken])

  const chess = useMemo(() => new Chess(currentFen), [currentFen])
  const current = bookReady ? findOpening(fens, currentIndex) : null

  // Book continuations: legal moves whose resulting position is a named opening.
  const book = useMemo(() => {
    if (!bookReady) return []
    const out: { san: string; eco: string; name: string }[] = []
    for (const m of chess.moves({ verbose: true })) {
      const next = new Chess(currentFen)
      next.move(m.san)
      const hit = findOpening([next.fen()], 0)
      if (hit) out.push({ san: m.san, ...hit })
    }
    return out.sort((a, b) => a.name.length - b.name.length)
  }, [bookReady, chess, currentFen])

  const playSan = (san: string) => {
    const m = chess.moves({ verbose: true }).find((x) => x.san === san)
    if (m) makeMove(m.from, m.to, m.promotion ?? 'q')
  }

  // Opening a game jumps straight to the position being explored.
  const openLocal = async (id: number) => {
    const g = await getGame(id)
    if (g.pgn) await loadPGN(g.pgn, { focusFen: currentFen })
  }
  const openMaster = async (id: string) => {
    setOpening(id)
    try {
      await loadPGN(await masterGamePgn(id), { focusFen: currentFen })
    } finally {
      setOpening(null)
    }
  }

  const localSection = (title: string, data: ExplorerResult | null, empty: string) => (
    <Section title={title}>
      {failed ? (
        <p className="text-red-400 text-xs">Não foi possível falar com o servidor.</p>
      ) : !data ? (
        <p className="text-[#8f9db3] text-xs">Buscando…</p>
      ) : data.games.length === 0 ? (
        <p className="text-[#8f9db3] text-xs">{empty}</p>
      ) : (
        <div className="space-y-3">
          {data.moves.length > 0 && (
            <ul className="space-y-1.5">
              {data.moves.map((m) => (
                <li key={m.san}>
                  <button onClick={() => playSan(m.san)} className="w-full text-left group" title="Jogar este lance">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono font-semibold text-[#f1f4f8] group-hover:text-[#81b64c]">{m.san}</span>
                      <span className="text-[#8f9db3] font-mono">{fmt(m.count)} {m.count === 1 ? 'partida' : 'partidas'}</span>
                    </div>
                    <ResultBar w={m.white} d={m.draws} b={m.black} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <ul className="space-y-1">
            {data.games.map((g) => (
              <li key={g.id}>
                <button
                  onClick={() => openLocal(g.id)}
                  className="w-full text-left px-2 py-1.5 rounded border border-[#34435a] bg-[#1a2230] hover:bg-[#2a3648]"
                  title="Abrir esta partida nesta posição"
                >
                  <div className="text-xs text-[#f1f4f8] truncate">
                    {g.white}{g.white_elo ? <span className="text-[#8f9db3]"> {g.white_elo}</span> : null}
                    <span className="text-[#8f9db3]"> x </span>
                    {g.black}{g.black_elo ? <span className="text-[#8f9db3]"> {g.black_elo}</span> : null}
                    <span className="ml-2 font-mono text-[#8f9db3]">{g.result}</span>
                  </div>
                  <div className="text-[10px] text-[#8f9db3] truncate">{[g.event, g.game_date].filter(Boolean).join(' · ')}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  )

  const m = master?.status === 'ok' ? master.data : null
  const mTotal = m ? m.white + m.draws + m.black : 0

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[#34435a] bg-[#212b3a] p-3">
        <div className="text-[#8f9db3] text-[10px] uppercase tracking-wider mb-1">Posição</div>
        {current ? (
          <div className="text-sm text-[#f1f4f8]">
            <span className="font-mono font-semibold text-[#81b64c] mr-2">{current.eco}</span>
            {current.name}
          </div>
        ) : (
          <div className="text-sm text-[#8f9db3]">{currentIndex === 0 ? 'Posição inicial' : 'Fora do livro de aberturas'}</div>
        )}
      </div>

      <Section title="Mestres · Lichess" right={m ? <span className="text-[10px] font-mono text-[#8f9db3]">{fmt(mTotal)} partidas</span> : null}>
        {!serverEngine ? (
          <p className="text-[#8f9db3] text-xs">Precisa do servidor (<code className="text-[#f1f4f8]">pnpm server</code>).</p>
        ) : !master ? (
          <p className="text-[#8f9db3] text-xs">Buscando…</p>
        ) : master.status === 'token-required' || master.status === 'token-rejected' ? (
          <TokenForm rejected={master.status === 'token-rejected'} onSaved={() => setMasterTick((t) => t + 1)} />
        ) : master.status === 'rate-limited' ? (
          <p className="text-amber-400 text-xs">O Lichess está limitando as requisições — espere um minuto e navegue de novo.</p>
        ) : master.status !== 'ok' ? (
          <p className="text-[#8f9db3] text-xs">Não foi possível acessar o Lichess agora (sem internet?).</p>
        ) : mTotal === 0 ? (
          <p className="text-[#8f9db3] text-xs">Nenhuma partida de mestres chegou a esta posição.</p>
        ) : (
          <div className="space-y-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[#5f6d83] text-[10px] uppercase">
                  <th className="text-left font-normal pb-1">Lance</th>
                  <th className="text-right font-normal pb-1 pr-2">Partidas</th>
                  <th className="text-right font-normal pb-1 pr-2" title="Rating médio">Elo</th>
                  <th className="font-normal pb-1 w-[45%]">Resultados</th>
                </tr>
              </thead>
              <tbody>
                {m!.moves.map((mv) => {
                  const n = mv.white + mv.draws + mv.black
                  return (
                    <tr
                      key={mv.uci}
                      onClick={() => playSan(mv.san)}
                      className="cursor-pointer hover:bg-[#2a3648]"
                      title="Jogar este lance"
                    >
                      <td className="py-1 font-mono font-semibold text-[#f1f4f8]">{mv.san}</td>
                      <td className="py-1 pr-2 text-right font-mono text-[#8f9db3]">
                        {fmt(n)} <span className="text-[#5f6d83]">{Math.round((n / mTotal) * 100)}%</span>
                      </td>
                      <td className="py-1 pr-2 text-right font-mono text-[#8f9db3]">{mv.averageRating}</td>
                      <td className="py-1">
                        <ResultBar w={mv.white} d={mv.draws} b={mv.black} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {m!.topGames.length > 0 && (
              <ul className="space-y-1">
                {m!.topGames.map((g) => (
                  <li key={g.id}>
                    <button
                      onClick={() => openMaster(g.id)}
                      disabled={opening !== null}
                      className="w-full text-left px-2 py-1.5 rounded border border-[#34435a] bg-[#1a2230] hover:bg-[#2a3648] disabled:opacity-60"
                      title="Abrir esta partida nesta posição"
                    >
                      <div className="text-xs text-[#f1f4f8] truncate">
                        {g.white.name} <span className="text-[#8f9db3]">{g.white.rating}</span>
                        <span className="text-[#8f9db3]"> x </span>
                        {g.black.name} <span className="text-[#8f9db3]">{g.black.rating}</span>
                      </div>
                      <div className="text-[10px] text-[#8f9db3]">
                        {g.year} · {g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½'}
                        {opening === g.id ? ' · abrindo…' : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Section>

      {serverEngine && hasImports && localSection('Base importada', imported, 'Nenhuma partida importada chegou a esta posição.')}

      <Section title="Lances de livro">
        {!bookReady ? (
          <p className="text-[#8f9db3] text-xs">Carregando livro de aberturas…</p>
        ) : book.length === 0 ? (
          <p className="text-[#8f9db3] text-xs">Nenhuma continuação de livro a partir desta posição.</p>
        ) : (
          <ul className="space-y-1">
            {book.map((b) => (
              <li key={b.san}>
                <button
                  onClick={() => playSan(b.san)}
                  title="Jogar este lance"
                  className="w-full flex items-baseline gap-2 px-2 py-1.5 rounded border border-[#34435a] bg-[#1a2230] hover:bg-[#2a3648] text-left"
                >
                  <span className="font-mono font-semibold text-sm text-[#f1f4f8] w-12 shrink-0">{b.san}</span>
                  <span className="text-[#8f9db3] text-[11px] truncate flex-1">{b.name}</span>
                  <span className="font-mono text-[10px] text-[#5f6d83]">{b.eco}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {serverEngine
        ? localSection('Nas suas partidas salvas', mine, 'Nenhuma partida salva chegou a esta posição.')
        : (
          <Section title="Nas suas partidas salvas">
            <p className="text-[#8f9db3] text-xs">Precisa do servidor (<code className="text-[#f1f4f8]">pnpm server</code>).</p>
          </Section>
        )}
    </div>
  )
}
