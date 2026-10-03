import { useEffect, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import { useGame } from '../store/GameContext'
import { OPPONENT_ELO_MAX, OPPONENT_ELO_MIN, OpponentEngine } from '../engine/OpponentEngine'

/**
 * "Play vs Stockfish": a strength-limited engine answers your moves. It only moves when the
 * board shows the end of the line and it is its turn, so you can step back to look at the
 * game (or switch to Coach mode for hints) without the engine playing over you.
 */
export default function PlayVsEngine({ className }: { className: string }) {
  const { fens, currentIndex, makeMove, resetGame, flipBoard, setPlayerName } = useGame()
  const [open, setOpen] = useState(false)
  const [elo, setElo] = useState(1500)
  const [side, setSide] = useState<'w' | 'b' | 'random'>('w')
  const [playing, setPlaying] = useState<{ engineColor: 'w' | 'b'; elo: number } | null>(null)
  const [thinking, setThinking] = useState(false)
  const engineRef = useRef<OpponentEngine | null>(null)

  useEffect(() => () => engineRef.current?.destroy(), [])

  const atEnd = currentIndex === fens.length - 1
  const fen = fens[currentIndex]

  useEffect(() => {
    if (!playing || !atEnd) return
    const chess = new Chess(fen)
    if (chess.isGameOver() || chess.turn() !== playing.engineColor) return
    engineRef.current ??= new OpponentEngine()
    let alive = true
    setThinking(true)
    engineRef.current
      .bestMove(fen, playing.elo)
      .then((uci) => {
        if (alive) makeMove(uci.slice(0, 2), uci.slice(2, 4), uci[4] ?? 'q')
      })
      .catch(() => {})
      .finally(() => alive && setThinking(false))
    return () => {
      alive = false
      engineRef.current?.cancel()
      setThinking(false)
    }
  }, [playing, atEnd, fen, makeMove])

  const start = () => {
    const you = side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : side
    resetGame() // always leaves White at the bottom
    if (you === 'b') flipBoard()
    const botName = `Stockfish ${elo}`
    setPlayerName(you === 'w' ? 'white' : 'black', 'Você')
    setPlayerName(you === 'w' ? 'black' : 'white', botName)
    setPlaying({ engineColor: you === 'w' ? 'b' : 'w', elo })
    setOpen(false)
  }

  if (playing) {
    return (
      <button
        onClick={() => {
          engineRef.current?.cancel()
          setPlaying(null)
        }}
        className={`${className} !border-[#a371f7]/60 !text-[#d2a8ff]`}
        title="Parar de jogar contra o motor"
      >
        {thinking ? '🤖 pensando…' : `🤖 x ${playing.elo}`} ✕
      </button>
    )
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className={className} title="Jogue uma partida contra o Stockfish na força escolhida">
        🤖 Jogar
      </button>
      {open && (
        <div className="absolute z-30 bottom-full mb-2 left-0 w-64 rounded-xl border border-[#30363d] bg-[#161b22] p-3 shadow-2xl space-y-3 text-xs text-[#8b949e]">
          <div className="text-[#e6edf3] font-semibold text-sm">Jogar contra o Stockfish</div>
          <div>
            <div className="mb-1">Você joga de</div>
            <div className="flex rounded border border-[#30363d] overflow-hidden">
              {([['w', 'Brancas'], ['b', 'Pretas'], ['random', 'Sorteio']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setSide(v)}
                  className={`flex-1 py-1 ${side === v ? 'bg-[#388bfd] text-white' : 'hover:bg-[#21262d]'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <div className="flex justify-between mb-1">
              <span>Força</span>
              <span className="font-mono text-[#e6edf3]">{elo} Elo</span>
            </div>
            <input
              type="range"
              min={OPPONENT_ELO_MIN}
              max={OPPONENT_ELO_MAX}
              step={50}
              value={elo}
              onChange={(e) => setElo(parseInt(e.target.value))}
              className="w-full accent-[#a371f7]"
            />
          </label>
          <p className="text-[10px] leading-relaxed">
            Começa uma nova partida. Dica: mude para <b>Treino</b> para receber o retorno do Coach a cada lance.
          </p>
          <button onClick={start} className="w-full py-1.5 rounded bg-[#a371f7] text-white font-medium hover:bg-[#b083f8]">
            Começar partida
          </button>
        </div>
      )}
    </div>
  )
}
