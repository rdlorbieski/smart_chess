import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { GameProvider, useGame } from './store/GameContext'
import ChessBoard from './components/ChessBoard'
import EvaluationBar from './components/EvaluationBar'
import MoveList from './components/MoveList'
import CriticalityTimeline from './components/CriticalityTimeline'
import AnalysisPanel from './components/AnalysisPanel'
import GameControls from './components/GameControls'
import PlayerNameplate from './components/PlayerNameplate'
import OpeningBadge from './components/OpeningBadge'
import ExplorerPanel from './components/ExplorerPanel'
import GameReport from './components/GameReport'
import { capturedGlyphs, materialFor } from './lib/material'

/**
 * Square board size: fits the viewport height (minus header/controls) and, on phones, the
 * width (minus the eval bar and gutters). Never below 280px, so a tiny or momentarily
 * zero-height window can't produce a negative size (the browser would drop the style and
 * the board would stretch to the full column), and it follows window resizes.
 */
function useBoardSize() {
  const compute = () => {
    if (typeof window === 'undefined') return 480
    const byHeight = window.innerHeight - 200
    const byWidth = window.innerWidth - 72 // eval bar (28) + gap (12) + 16px gutters
    return Math.max(280, Math.min(560, byHeight, byWidth))
  }
  const [size, setSize] = useState(compute)
  useEffect(() => {
    const onResize = () => setSize(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

function AppInner() {
  const { liveEval, engineReady, currentIndex, fens, moves, orientation,
          playerWhite, playerBlack, setPlayerName, clock } = useGame()
  const [previewMoves, setPreviewMoves] = useState<string[] | null>(null)
  const [tab, setTab] = useState<'analysis' | 'explorer' | 'report'>('analysis')
  const currentFenForMaterial = fens[currentIndex] ?? fens[0]
  const material = useMemo(() => materialFor(currentFenForMaterial), [currentFenForMaterial])

  const boardSize = useBoardSize()

  const chess = new Chess(fens[currentIndex] ?? fens[0])
  const isAnalyzing = moves[currentIndex - 1]?.isAnalyzing ?? false

  let gameStatus = chess.turn() === 'w' ? 'Brancas jogam' : 'Pretas jogam'
  if (chess.isCheckmate()) gameStatus = chess.turn() === 'w' ? 'Xeque-mate — vitória das pretas' : 'Xeque-mate — vitória das brancas'
  else if (chess.isDraw()) gameStatus = 'Empate'
  else if (chess.isCheck()) gameStatus = `${gameStatus} — Xeque!`

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex flex-col select-none">

      {/* Header */}
      <header className="px-5 py-3 border-b border-[#21262d] flex items-center gap-3 shrink-0">
        <span className="text-[#388bfd] text-xl">♟</span>
        <span className="font-display font-semibold text-lg tracking-tight text-[#e6edf3]">
          ChessMind
        </span>
        <span className="text-[#484f58] text-xs font-mono">Análise avançada</span>

        <div className="flex-1" />

        {chess.isCheck() && !chess.isCheckmate() && (
          <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-500/20 text-amber-400 animate-pulse">
            XEQUE
          </span>
        )}
        <span className="text-[#7d8590] text-xs font-mono hidden md:inline">{gameStatus}</span>

        <div className="flex items-center gap-1.5 ml-2">
          <span className={`w-2 h-2 rounded-full ${engineReady ? 'bg-[#3fb950]' : 'bg-amber-500 animate-pulse'}`} />
          <span className="text-[#7d8590] text-xs hidden sm:inline">
            {engineReady ? 'Stockfish' : 'Carregando motor…'}
          </span>
        </div>
      </header>

      {/* Main grid */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_320px] min-h-0">

        {/* Left column: board area */}
        <div className="flex flex-col gap-4 p-4 xl:p-6">

          {/* Board + eval bar */}
          <div className="flex flex-col" style={{ width: boardSize + 40 }}>
            {/* Top nameplate indented past the eval bar (28px bar + 12px gap) */}
            <div style={{ paddingLeft: 40 }}>
              <PlayerNameplate
                name={orientation === 'white' ? playerBlack : playerWhite}
                color={orientation === 'white' ? 'black' : 'white'}
                isActive={chess.turn() === (orientation === 'white' ? 'b' : 'w')}
                onRename={(n) => setPlayerName(orientation === 'white' ? 'black' : 'white', n)}
                clockMs={clock.enabled ? clock[orientation === 'white' ? 'b' : 'w'] : null}
                flagged={clock.flagged === (orientation === 'white' ? 'b' : 'w')}
                captured={capturedGlyphs(material[orientation === 'white' ? 'b' : 'w'].captured, orientation === 'white' ? 'b' : 'w')}
                lead={material[orientation === 'white' ? 'b' : 'w'].lead}
              />
            </div>

            {/* Eval bar + board — same height via items-stretch */}
            <div className="flex gap-3 items-stretch" style={{ height: boardSize }}>
              <EvaluationBar score={liveEval} isAnalyzing={isAnalyzing} flipped={orientation === 'black'} />
              <div className="min-w-0 flex-1">
                <ChessBoard
                  previewMoves={previewMoves ?? undefined}
                  onClearPreview={() => setPreviewMoves(null)}
                />
              </div>
            </div>

            {/* Bottom nameplate */}
            <div style={{ paddingLeft: 40 }}>
              <PlayerNameplate
                name={orientation === 'white' ? playerWhite : playerBlack}
                color={orientation === 'white' ? 'white' : 'black'}
                isActive={chess.turn() === (orientation === 'white' ? 'w' : 'b')}
                onRename={(n) => setPlayerName(orientation === 'white' ? 'white' : 'black', n)}
                clockMs={clock.enabled ? clock[orientation === 'white' ? 'w' : 'b'] : null}
                flagged={clock.flagged === (orientation === 'white' ? 'w' : 'b')}
                captured={capturedGlyphs(material[orientation === 'white' ? 'w' : 'b'].captured, orientation === 'white' ? 'w' : 'b')}
                lead={material[orientation === 'white' ? 'w' : 'b'].lead}
              />
            </div>
          </div>

          {/* Controls bar */}
          <div className="rounded-xl border border-[#21262d] bg-[#161b22] px-4 py-3">
            <GameControls />
          </div>

          {/* Move history */}
          <div className="rounded-xl border border-[#21262d] bg-[#161b22] px-4 py-3">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <span className="font-display text-[#7d8590] shrink-0 text-[10px] uppercase tracking-widest font-medium">
                Histórico de lances
              </span>
              <OpeningBadge />
              <span className="text-[#484f58] text-[10px] font-mono shrink-0 ml-3">
                {currentIndex} / {fens.length - 1} lances
              </span>
            </div>
            <MoveList />
            <CriticalityTimeline />
          </div>
        </div>

        {/* Right column: analysis */}
        <div className="xl:border-l xl:border-[#21262d] flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto scrollbar-hide p-4 xl:p-5">
            <div className="flex gap-1 mb-4 border-b border-[#21262d]">
              {([['analysis', 'Análise'], ['explorer', '📖 Explorador'], ['report', '📈 Relatório']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`px-3 py-2 text-[11px] uppercase tracking-widest font-medium border-b-2 -mb-px transition-colors ${
                    tab === id ? 'border-[#388bfd] text-[#e6edf3]' : 'border-transparent text-[#7d8590] hover:text-[#e6edf3]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {tab === 'analysis' ? (
              <AnalysisPanel onPreviewLine={(mvs) => setPreviewMoves(mvs)} />
            ) : tab === 'explorer' ? (
              <ExplorerPanel />
            ) : (
              <GameReport />
            )}
          </div>

          {/* Legend */}
          <div className="border-t border-[#21262d] px-4 py-3 shrink-0">
            <div className="grid grid-cols-4 gap-2">
              {([
                { sym: '!!', label: 'Brilhante', color: '#0ea5e9' },
                { sym: '!',  label: 'Melhor',    color: '#22c55e' },
                { sym: '?!', label: 'Imprecisão',color: '#eab308' },
                { sym: '??', label: 'Erro grave', color: '#ef4444' },
              ]).map((item) => (
                <div key={item.sym} className="flex flex-col items-center gap-0.5">
                  <span className="font-mono text-xs font-bold" style={{ color: item.color }}>{item.sym}</span>
                  <span className="text-[10px] text-[#484f58] text-center">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <GameProvider>
      <AppInner />
    </GameProvider>
  )
}
