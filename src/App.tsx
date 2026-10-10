import { useEffect, useMemo, useState } from 'react'
import { Chess } from 'chess.js'
import { GameProvider, useGame } from './store/GameContext'
import ChessBoard from './components/ChessBoard'
import EvaluationBar from './components/EvaluationBar'
import MoveList from './components/MoveList'
import CriticalityTimeline from './components/CriticalityTimeline'
import AnalysisPanel from './components/AnalysisPanel'
import { ActionRail, ModeToggle, NavBar } from './components/GameControls'
import PlayerNameplate from './components/PlayerNameplate'
import OpeningBadge from './components/OpeningBadge'
import ExplorerPanel from './components/ExplorerPanel'
import GameReport, { EvalGraph, gameAccuracy } from './components/GameReport'
import EngineLines from './components/EngineLines'
import ToMoveCard from './components/ToMoveCard'
import Icon, { type IconName } from './components/icons'
import LoginGate from './components/LoginGate'
import { capturedGlyphs, materialFor } from './lib/material'

const RAIL = 84 // left rail (md and up)
const PANEL = 440 // right panel (xl and up)

/**
 * Square board size: fits the viewport height (minus the nameplates) and the width left
 * by the rail, the eval bar and, on wide screens, the side panel. Never below 280px, so a
 * tiny or momentarily zero-height window can't produce a negative size (the browser would
 * drop the style and the board would stretch to the full column), and it follows resizes.
 */
function useBoardSize() {
  const compute = () => {
    if (typeof window === 'undefined') return 480
    const w = window.innerWidth
    const byHeight = window.innerHeight - 128 // two nameplates + padding
    const byWidth =
      w >= 1280 ? w - RAIL - PANEL - 24 - 32 - 40 : w >= 768 ? w - RAIL - 32 - 40 : w - 24 - 40 // eval bar + gap = 40
    return Math.max(280, Math.min(900, w >= 1280 ? byHeight : Math.max(byHeight, 320), byWidth))
  }
  const [size, setSize] = useState(compute)
  useEffect(() => {
    const onResize = () => setSize(compute())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

type Tab = 'moves' | 'analysis' | 'explorer' | 'report'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'moves', label: 'Lances', icon: 'moves' },
  { id: 'analysis', label: 'Análise', icon: 'analysis' },
  { id: 'explorer', label: 'Explorar', icon: 'book' },
  { id: 'report', label: 'Relatório', icon: 'chart' },
]

/** White / Black accuracy boxes with the result between them, plus the evaluation graph. */
function GameSummary() {
  const { moves, currentIndex, navigateTo, getPgn } = useGame()
  const analyzed = moves.filter((m) => m.isAnalyzed)
  const acc = useMemo(
    () => ({
      w: gameAccuracy(analyzed.filter((m) => m.color === 'w')),
      b: gameAccuracy(analyzed.filter((m) => m.color === 'b')),
    }),
    [analyzed],
  )
  if (!moves.length) return null
  const result = getPgn().result
  const box = (v: number | null, white: boolean) => (
    <div
      className={`flex-1 rounded-md py-1 text-center border-2 ${
        white ? 'bg-white text-[#1a2230] border-white' : 'bg-[#2b2b2b] text-white border-[#4a4a4a]'
      }`}
      title="Estimativa a partir da chance de vitória perdida por lance (fórmula do Lichess)"
    >
      <div className="text-lg font-bold leading-none">{v === null ? '—' : v.toFixed(1)}</div>
      <div className={`text-[9px] ${white ? 'text-[#5f6d83]' : 'text-[#a3afc2]'}`}>Precisão</div>
    </div>
  )
  return (
    <div className="px-3 pt-2.5 pb-1 border-b border-[#2a3648]">
      <div className="flex items-center gap-3">
        {box(acc.w, true)}
        <span className="text-xs font-semibold text-[#a3afc2] w-8 text-center">{result === '*' ? '' : result}</span>
        {box(acc.b, false)}
      </div>
      <div className="mt-2">
        <EvalGraph moves={moves} currentIndex={currentIndex} onSelect={navigateTo} className="h-12" />
      </div>
      <CriticalityTimeline compact />
    </div>
  )
}

function AppInner() {
  const { liveEval, currentIndex, fens, moves, orientation, mode, meta,
          playerWhite, playerBlack, setPlayerName, clock } = useGame()
  const [previewMoves, setPreviewMoves] = useState<string[] | null>(null)
  const [tab, setTab] = useState<Tab>('moves')
  const currentFenForMaterial = fens[currentIndex] ?? fens[0]
  const material = useMemo(() => materialFor(currentFenForMaterial), [currentFenForMaterial])

  // Coach mode lives in the Analysis tab ("your move / try again / show best move").
  useEffect(() => {
    if (mode === 'training') setTab('analysis')
  }, [mode])

  const boardSize = useBoardSize()

  const chess = new Chess(fens[currentIndex] ?? fens[0])
  const isAnalyzing = moves[currentIndex - 1]?.isAnalyzing ?? false

  let gameOver = ''
  if (chess.isCheckmate()) gameOver = chess.turn() === 'w' ? 'Xeque-mate — vitória das pretas' : 'Xeque-mate — vitória das brancas'
  else if (chess.isDraw()) gameOver = 'Empate'

  const nameplate = (side: 'top' | 'bottom') => {
    const color: 'white' | 'black' = (side === 'bottom') === (orientation === 'white') ? 'white' : 'black'
    const c = color === 'white' ? 'w' : 'b'
    return (
      <div style={{ paddingLeft: 40 }}>
        <PlayerNameplate
          name={color === 'white' ? playerWhite : playerBlack}
          color={color}
          isActive={chess.turn() === c}
          onRename={(n) => setPlayerName(color, n)}
          clockMs={clock.enabled ? clock[c] : null}
          flagged={clock.flagged === c}
          captured={capturedGlyphs(material[c].captured, c)}
          lead={material[c].lead}
        />
      </div>
    )
  }

  return (
    <div className="min-h-screen text-[#f1f4f8] flex flex-col md:flex-row select-none">
      <ActionRail />

      <main className="flex-1 min-w-0 flex flex-col xl:flex-row xl:items-start xl:justify-center gap-4 xl:gap-6 p-3 md:p-4">
        {/* Board column: nameplates above/below, eval bar on the left */}
        <div className="flex flex-col shrink-0 mx-auto xl:mx-0" style={{ width: boardSize + 40 }}>
          {nameplate('top')}
          <div className="flex gap-3 items-stretch" style={{ height: boardSize }}>
            <EvaluationBar score={liveEval} isAnalyzing={isAnalyzing} flipped={orientation === 'black'} />
            <div className="min-w-0 flex-1">
              <ChessBoard previewMoves={previewMoves ?? undefined} onClearPreview={() => setPreviewMoves(null)} />
            </div>
          </div>
          {nameplate('bottom')}
        </div>

        {/* Side panel */}
        <aside className="w-full xl:w-[440px] xl:shrink-0 flex flex-col rounded-lg bg-[#212b3a] overflow-hidden shadow-xl xl:sticky xl:top-4 xl:h-[calc(100vh-32px)]">
          <div className="flex flex-col flex-1 min-h-0">
            <header className="flex items-center gap-2 px-3 py-2.5 bg-[#1c2533] border-b border-[#2a3648]">
              <Icon name="analysis" size={18} className="text-[#81b64c] shrink-0" />
              <span className="font-display font-semibold text-[15px] truncate">{meta.event || 'Análise'}</span>
              <div className="ml-auto shrink-0">
                <ModeToggle />
              </div>
            </header>

            <div className="grid grid-cols-4 bg-[#1c2533] border-b border-[#2a3648]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold border-b-2 transition-colors ${
                    tab === t.id ? 'border-white text-white bg-[#212b3a]' : 'border-transparent text-[#8f9db3] hover:text-white'
                  }`}
                >
                  <Icon name={t.icon} size={18} />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
              {tab === 'moves' ? (
                <>
                  <EngineLines onPreviewLine={setPreviewMoves} />
                  <div className="px-3 py-2.5 border-b border-[#2a3648]">
                    <ToMoveCard onPreviewLine={setPreviewMoves} />
                  </div>
                  <GameSummary />
                  <div className="px-3 py-1.5 min-h-[30px] flex items-center border-b border-[#2a3648]">
                    <OpeningBadge />
                  </div>
                  <MoveList fill />
                  {gameOver && <div className="px-3 py-2 text-center text-xs font-semibold text-[#f1f4f8] bg-[#273345]">{gameOver}</div>}
                </>
              ) : (
                <div className="p-3">
                  {tab === 'analysis' ? (
                    <AnalysisPanel onPreviewLine={setPreviewMoves} />
                  ) : tab === 'explorer' ? (
                    <ExplorerPanel />
                  ) : (
                    <GameReport />
                  )}
                </div>
              )}
            </div>

            <NavBar />
          </div>
        </aside>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <LoginGate>
      <GameProvider>
        <AppInner />
      </GameProvider>
    </LoginGate>
  )
}
