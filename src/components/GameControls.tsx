import { useEffect, useState } from 'react'
import { useGame } from '../store/GameContext'
import { CLOCK_PRESETS } from '../store/useChessClock'
import { downloadText } from '../lib/pgn'
import { SaveGameModal, LibraryModal } from './GameLibrary'
import PlayVsEngine from './PlayVsEngine'
import Icon, { type IconName } from './icons'
import { useAuth } from './LoginGate'
import { onSoundChange, setSoundEnabled, soundEnabled } from '../lib/sound'

function PgnModal({ onClose }: { onClose: () => void }) {
  const { loadPGN, loadFEN } = useGame()
  const [text, setText] = useState('')
  const [tab, setTab] = useState<'pgn' | 'fen'>('pgn')

  const handleLoad = async () => {
    if (tab === 'pgn') {
      await loadPGN(text.trim())
    } else {
      loadFEN(text.trim())
    }
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#212b3a] border border-[#34435a] rounded-xl p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#f1f4f8] font-semibold">Carregar posição</h2>
          <button onClick={onClose} className="text-[#8f9db3] hover:text-[#f1f4f8] text-lg">✕</button>
        </div>

        <div className="flex gap-2 mb-3">
          {(['pgn', 'fen'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-[#81b64c] text-white'
                  : 'text-[#8f9db3] hover:text-[#f1f4f8]'
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tab === 'pgn' ? '1. e4 e5 2. Nf3 Nc6 …' : 'rnbqkbnr/pppppppp/…'}
          className="w-full h-36 bg-[#1a2230] border border-[#34435a] rounded-lg p-3 text-[#f1f4f8] text-sm font-mono resize-none focus:outline-none focus:border-[#81b64c] placeholder-[#8f9db3]"
        />

        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#34435a] text-[#8f9db3] text-sm hover:bg-[#2a3648] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleLoad}
            disabled={!text.trim()}
            className="px-4 py-2 rounded-lg bg-[#81b64c] text-white text-sm font-medium hover:bg-[#95c95f] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Carregar
          </button>
        </div>
      </div>
    </div>
  )
}

const railBtn =
  'relative flex flex-col items-center justify-center gap-1 w-full md:w-auto min-w-[64px] px-1 py-2 rounded-md text-[10px] leading-tight text-[#a3afc2] hover:bg-[#2a3648] hover:text-white transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed'

function RailButton({ icon, label, title, onClick, disabled, active }: {
  icon: IconName
  label: string
  title?: string
  onClick?: () => void
  disabled?: boolean
  active?: boolean
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title ?? label} className={`${railBtn} ${active ? '!text-[#81b64c]' : ''}`}>
      <Icon name={icon} size={22} />
      <span>{label}</span>
    </button>
  )
}

/** Clock presets + start/pause, in a small popover next to the rail. */
function ClockButton() {
  const { clock, configureClock, startClock, pauseClock } = useGame()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <RailButton icon="clock" label="Relógio" onClick={() => setOpen((o) => !o)} active={clock.enabled} />
      {open && (
        <div className="absolute z-30 left-full ml-2 top-0 w-52 rounded-lg border border-[#34435a] bg-[#212b3a] p-3 shadow-2xl space-y-2 text-xs text-[#a3afc2]">
          <div className="text-[#f1f4f8] font-semibold text-sm">Relógio</div>
          <select
            value={clock.enabled ? `${clock.initialMs / 60000}+${clock.incrementMs / 1000}` : 'off'}
            onChange={(e) => configureClock(CLOCK_PRESETS.find((p) => p.label === e.target.value) ?? null)}
            className="w-full h-8 rounded border border-[#34435a] bg-[#1a2230] text-[#f1f4f8] px-2"
          >
            <option value="off">Sem relógio</option>
            {CLOCK_PRESETS.map((p) => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
          {clock.enabled && (
            <button
              className="w-full py-1.5 rounded bg-[#81b64c] text-white font-semibold hover:bg-[#95c95f] disabled:opacity-40"
              onClick={() => {
                if (clock.running) pauseClock()
                else startClock()
                setOpen(false)
              }}
              disabled={!!clock.flagged}
            >
              {clock.flagged ? 'Tempo!' : clock.running ? '⏸ Pausar' : '▶ Iniciar'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * chess.com-style left rail: logo and the game actions (new, load, library, save, export,
 * play the engine, clock); log out at the bottom. Horizontal strip on phones.
 */
export function ActionRail() {
  const { resetGame, getPgn, moves, playerWhite, playerBlack } = useGame()
  const auth = useAuth()
  const [showPgn, setShowPgn] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [copied, setCopied] = useState(false)

  const exportPgn = () => {
    const { pgn } = getPgn()
    downloadText(`${playerWhite}-vs-${playerBlack}.pgn`.replace(/[^\w.-]+/g, '_'), pgn)
  }
  const copyPgn = async () => {
    await navigator.clipboard.writeText(getPgn().pgn)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      {showPgn && <PgnModal onClose={() => setShowPgn(false)} />}
      {showSave && <SaveGameModal onClose={() => setShowSave(false)} />}
      {showLibrary && <LibraryModal onClose={() => setShowLibrary(false)} />}

      <nav className="shrink-0 flex md:flex-col items-center gap-1 px-2 py-2 md:py-3 bg-[#151c28] border-b md:border-b-0 md:border-r border-[#2a3648] overflow-x-auto md:overflow-visible md:w-[84px] md:h-screen md:sticky md:top-0 z-20">
        <div className="flex flex-col items-center shrink-0 px-2 md:mb-3" title="ChessMind">
          <span className="text-[#81b64c] text-3xl leading-none">♞</span>
          <span className="hidden md:block font-display font-bold text-[11px] text-white mt-0.5">ChessMind</span>
        </div>
        <RailButton icon="plus" label="Nova" title="Nova partida" onClick={resetGame} />
        <RailButton icon="upload" label="PGN / FEN" title="Carregar PGN ou FEN" onClick={() => setShowPgn(true)} />
        <RailButton icon="library" label="Biblioteca" title="Partidas salvas" onClick={() => setShowLibrary(true)} />
        <RailButton icon="save" label="Salvar" title="Salvar na biblioteca (precisa do servidor)" onClick={() => setShowSave(true)} />
        <RailButton icon="download" label="Exportar" title="Baixar PGN" onClick={exportPgn} disabled={moves.length === 0} />
        <RailButton icon="copy" label={copied ? 'Copiado ✓' : 'Copiar'} title="Copiar PGN" onClick={copyPgn} disabled={moves.length === 0} />
        <PlayVsEngine
          className={railBtn}
          placement="right"
          label={
            <>
              <Icon name="robot" size={22} />
              <span>Jogar</span>
            </>
          }
          activeLabel={(thinking, elo) => (
            <>
              <Icon name="robot" size={22} className="text-[#d2a8ff]" />
              <span className="text-[#d2a8ff]">{thinking ? 'pensando…' : `${elo} ✕`}</span>
            </>
          )}
        />
        <ClockButton />
        {auth.user && (
          <div className="md:mt-auto">
            <RailButton icon="logout" label="Sair" title={`Sair (${auth.user})`} onClick={auth.logout} />
          </div>
        )}
      </nav>
    </>
  )
}

const toolBtn =
  'w-9 h-9 flex items-center justify-center rounded-md text-[#a3afc2] hover:bg-[#2a3648] hover:text-white transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed'

/** Panel footer: move navigation (big chevrons) and the board toggles. */
export function NavBar() {
  const {
    currentIndex, fens, navigateBack, navigateForward, navigateStart, navigateEnd, flipBoard,
    showArrows, setShowArrows, showTrapArrows, setShowTrapArrows,
  } = useGame()
  const [sound, setSound] = useState(soundEnabled)
  useEffect(() => onSoundChange(setSound), [])

  const isAtStart = currentIndex === 0
  const isAtEnd = currentIndex === fens.length - 1

  return (
    <div className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 border-t border-[#2a3648] bg-[#1c2533]">
      <button className={toolBtn} onClick={navigateStart} disabled={isAtStart} title="Início">
        <Icon name="first" size={22} />
      </button>
      <button className={toolBtn} onClick={navigateBack} disabled={isAtStart} title="Voltar (←)">
        <Icon name="prev" size={22} />
      </button>
      <button className={toolBtn} onClick={navigateForward} disabled={isAtEnd} title="Avançar (→)">
        <Icon name="next" size={22} />
      </button>
      <button className={toolBtn} onClick={navigateEnd} disabled={isAtEnd} title="Fim">
        <Icon name="last" size={22} />
      </button>

      <div className="flex-1" />

      <button
        className={`${toolBtn} ${showArrows ? '!text-[#81b64c]' : ''}`}
        onClick={() => setShowArrows(!showArrows)}
        title="Setas com os melhores lances do motor (mais forte = melhor)"
      >
        <Icon name="arrow" size={18} />
      </button>
      <button
        className={`${toolBtn} ${showTrapArrows ? '!text-[#f87171]' : ''}`}
        onClick={() => setShowTrapArrows(!showTrapArrows)}
        title="Setas vermelhas nas armadilhas ocultas: lances que parecem bons mas perdem com cálculo mais fundo"
      >
        <Icon name="trap" size={18} />
      </button>
      <button className={toolBtn} onClick={flipBoard} title="Girar tabuleiro">
        <Icon name="flip" size={18} />
      </button>
      <button
        className={toolBtn}
        onClick={() => setSoundEnabled(!sound)}
        title={sound ? 'Silenciar sons dos lances' : 'Ativar sons dos lances'}
        aria-label={sound ? 'Silenciar sons dos lances' : 'Ativar sons dos lances'}
      >
        <Icon name={sound ? 'soundOn' : 'soundOff'} size={18} />
      </button>
    </div>
  )
}

/** Analysis / Coach ("Treino") switch. */
export function ModeToggle() {
  const { mode, setMode } = useGame()
  return (
    <div className="flex items-center rounded-md bg-[#1a2230] p-0.5">
      {(['analysis', 'training'] as const).map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
            mode === m ? 'bg-[#34435a] text-white' : 'text-[#8f9db3] hover:text-white'
          }`}
          title={m === 'training' ? 'Treino: esconde o melhor lance e dá retorno de Coach a cada lance' : 'Análise livre'}
        >
          {m === 'analysis' ? 'Análise' : 'Treino'}
        </button>
      ))}
    </div>
  )
}
