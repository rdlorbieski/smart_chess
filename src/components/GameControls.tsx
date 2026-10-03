import { useEffect, useState } from 'react'
import { useGame } from '../store/GameContext'
import { CLOCK_PRESETS } from '../store/useChessClock'
import { downloadText } from '../lib/pgn'
import { SaveGameModal, LibraryModal } from './GameLibrary'
import PlayVsEngine from './PlayVsEngine'
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
        className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 w-full max-w-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[#e6edf3] font-semibold">Carregar posição</h2>
          <button onClick={onClose} className="text-[#7d8590] hover:text-[#e6edf3] text-lg">✕</button>
        </div>

        <div className="flex gap-2 mb-3">
          {(['pgn', 'fen'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                tab === t
                  ? 'bg-[#388bfd] text-white'
                  : 'text-[#7d8590] hover:text-[#e6edf3]'
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
          className="w-full h-36 bg-[#0d1117] border border-[#30363d] rounded-lg p-3 text-[#e6edf3] text-sm font-mono resize-none focus:outline-none focus:border-[#388bfd] placeholder-[#7d8590]"
        />

        <div className="flex gap-2 mt-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#30363d] text-[#7d8590] text-sm hover:bg-[#21262d] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleLoad}
            disabled={!text.trim()}
            className="px-4 py-2 rounded-lg bg-[#388bfd] text-white text-sm font-medium hover:bg-[#58a6ff] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Carregar
          </button>
        </div>
      </div>
    </div>
  )
}

export default function GameControls() {
  const {
    currentIndex,
    fens,
    navigateBack,
    navigateForward,
    navigateStart,
    navigateEnd,
    flipBoard,
    setMode,
    mode,
    resetGame,
    clock,
    configureClock,
    startClock,
    pauseClock,
    getPgn,
    moves,
    playerWhite,
    playerBlack,
    showArrows,
    setShowArrows,
    showTrapArrows,
    setShowTrapArrows,
  } = useGame()

  const [showPgn, setShowPgn] = useState(false)
  const [showSave, setShowSave] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [copied, setCopied] = useState(false)
  const [sound, setSound] = useState(soundEnabled)
  useEffect(() => onSoundChange(setSound), [])

  const exportPgn = () => {
    const { pgn } = getPgn()
    downloadText(`${playerWhite}-vs-${playerBlack}.pgn`.replace(/[^\w.-]+/g, '_'), pgn)
  }
  const copyPgn = async () => {
    await navigator.clipboard.writeText(getPgn().pgn)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const ghost =
    'h-8 px-3 rounded-lg border border-[#30363d] text-[#7d8590] text-xs hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  const isAtStart = currentIndex === 0
  const isAtEnd = currentIndex === fens.length - 1

  const btnClass = (disabled: boolean) =>
    `w-8 h-8 flex items-center justify-center rounded-lg border transition-colors text-sm ${
      disabled
        ? 'border-[#21262d] text-[#484f58] cursor-not-allowed'
        : 'border-[#30363d] text-[#7d8590] hover:bg-[#21262d] hover:text-[#e6edf3]'
    }`

  return (
    <>
      {showPgn && <PgnModal onClose={() => setShowPgn(false)} />}
      {showSave && <SaveGameModal onClose={() => setShowSave(false)} />}
      {showLibrary && <LibraryModal onClose={() => setShowLibrary(false)} />}

      <div className="flex items-center gap-2 flex-wrap">
        {/* Navigation */}
        <div className="flex items-center gap-1">
          <button className={btnClass(isAtStart)} onClick={navigateStart} disabled={isAtStart} title="Início">⏮</button>
          <button className={btnClass(isAtStart)} onClick={navigateBack} disabled={isAtStart} title="Voltar (←)">◀</button>
          <button className={btnClass(isAtEnd)} onClick={navigateForward} disabled={isAtEnd} title="Avançar (→)">▶</button>
          <button className={btnClass(isAtEnd)} onClick={navigateEnd} disabled={isAtEnd} title="Fim">⏭</button>
        </div>

        <div className="w-px h-6 bg-[#30363d]" />

        {/* Flip */}
        <button
          onClick={flipBoard}
          className="h-8 px-3 rounded-lg border border-[#30363d] text-[#7d8590] text-xs hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors"
          title="Girar tabuleiro"
        >
          ⟳ Girar
        </button>

        {/* Engine arrows */}
        <button
          onClick={() => setShowArrows(!showArrows)}
          className={`${ghost} ${showArrows ? '!border-[#22c55e]/50 !text-[#4ade80]' : ''}`}
          title="Setas com os melhores lances do motor (mais forte = melhor)"
        >
          ➶ Setas
        </button>
        <button
          onClick={() => setShowTrapArrows(!showTrapArrows)}
          className={`${ghost} ${showTrapArrows ? '!border-[#ef4444]/50 !text-[#f87171]' : ''}`}
          title="Setas vermelhas nas armadilhas ocultas: lances que parecem bons mas perdem com cálculo mais fundo (mais escuro = mais caro)"
        >
          ➶ Armadilhas
        </button>
        <button
          onClick={() => setSoundEnabled(!sound)}
          className={ghost}
          title={sound ? 'Silenciar sons dos lances' : 'Ativar sons dos lances'}
          aria-label={sound ? 'Silenciar sons dos lances' : 'Ativar sons dos lances'}
        >
          {sound ? '🔊' : '🔇'}
        </button>
        <PlayVsEngine className={ghost} />

        {/* Load PGN */}
        <button
          onClick={() => setShowPgn(true)}
          className="h-8 px-3 rounded-lg border border-[#30363d] text-[#7d8590] text-xs hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors"
        >
          Carregar PGN
        </button>

        {/* Reset */}
        <button
          onClick={resetGame}
          className="h-8 px-3 rounded-lg border border-[#30363d] text-[#7d8590] text-xs hover:bg-[#21262d] hover:text-[#e6edf3] transition-colors"
        >
          Nova partida
        </button>

        <button className={ghost} onClick={exportPgn} disabled={moves.length === 0} title="Baixar PGN">Exportar PGN</button>
        <button className={ghost} onClick={copyPgn} disabled={moves.length === 0} title="Copiar PGN">{copied ? 'Copiado ✓' : 'Copiar'}</button>
        <button className={ghost} onClick={() => setShowSave(true)} title="Salvar na biblioteca (precisa do servidor)">Salvar</button>
        <button className={ghost} onClick={() => setShowLibrary(true)} title="Partidas salvas">Biblioteca</button>

        <div className="w-px h-6 bg-[#30363d]" />

        {/* Clock */}
        <select
          value={clock.enabled ? `${clock.initialMs / 60000}+${clock.incrementMs / 1000}` : 'off'}
          onChange={(e) => configureClock(CLOCK_PRESETS.find((p) => p.label === e.target.value) ?? null)}
          className="h-8 rounded-lg border border-[#30363d] bg-[#161b22] text-[#7d8590] text-xs px-2"
          title="Relógio"
        >
          <option value="off">Sem relógio</option>
          {CLOCK_PRESETS.map((p) => (
            <option key={p.label} value={p.label}>{p.label}</option>
          ))}
        </select>
        {clock.enabled && (
          <button
            className={ghost}
            onClick={clock.running ? pauseClock : startClock}
            disabled={!!clock.flagged}
          >
            {clock.flagged ? 'Tempo!' : clock.running ? '⏸ Pausar' : '▶ Iniciar'}
          </button>
        )}

        <div className="flex-1" />

        {/* Mode toggle */}
        <div className="flex items-center rounded-lg border border-[#30363d] overflow-hidden">
          {(['analysis', 'training'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === m
                  ? 'bg-[#388bfd] text-white'
                  : 'text-[#7d8590] hover:bg-[#21262d] hover:text-[#e6edf3]'
              }`}
            >
              {m === 'analysis' ? 'Análise' : 'Treino'}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
