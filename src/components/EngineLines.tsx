import { useState } from 'react'
import { useGame } from '../store/GameContext'
import { evalToNumber, formatEval } from '../engine/ChessEngine'
import EngineSettings, { ThresholdControl } from './EngineSettings'
import { numberedLine } from '../lib/notation'

/**
 * chess.com-style engine strip: on/off switch, depth and engine name, then the top three
 * lines with their evaluation in a white (White better) or dark (Black better) box.
 */
export default function EngineLines({ onPreviewLine }: { onPreviewLine?: (moves: string[]) => void }) {
  const {
    currentFen, livePosition, engineReady, analysisPaused, stopAnalysis, resumeAnalysis, liveDepth,
    backend, serverEngine, mode, trainingReveal,
  } = useGame()
  const [settings, setSettings] = useState(false)

  const on = !analysisPaused
  const locked = mode === 'training' && !trainingReveal
  const lines = livePosition && livePosition.fen === currentFen ? livePosition.lines.slice(0, 3) : []
  const engineName =
    backend === 'server' ? (serverEngine === 'native' ? 'Stockfish nativo' : 'Stockfish (servidor)') : 'Stockfish (navegador)'

  return (
    <div className="border-b border-[#2a3648]">
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-[#8f9db3]">
        <button
          onClick={on ? stopAnalysis : resumeAnalysis}
          className="flex items-center gap-2 hover:text-[#f1f4f8]"
          title={on ? 'Parar a análise' : 'Retomar a análise'}
        >
          <span className={`relative w-7 h-4 rounded-full transition-colors ${on ? 'bg-[#81b64c]' : 'bg-[#34435a]'}`}>
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
          </span>
          <span className="font-medium text-[#f1f4f8]">Análise</span>
        </button>
        <span className="ml-auto text-[11px] truncate">
          {engineReady ? `prof. ${liveDepth || '—'} | ${engineName}` : 'Carregando motor…'}
        </span>
        <button
          onClick={() => setSettings((s) => !s)}
          className={`w-6 h-6 flex items-center justify-center rounded hover:bg-[#2a3648] ${settings ? 'text-[#f1f4f8] bg-[#2a3648]' : ''}`}
          title="Configurações do motor"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3.3h-4l-.4 2.6a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5ZM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" transform="translate(-1 0)" />
          </svg>
        </button>
      </div>

      {settings && (
        <div className="px-3 pb-3 space-y-2">
          <EngineSettings />
          <ThresholdControl />
        </div>
      )}

      <div className="pb-1.5">
        {locked ? (
          <p className="px-3 py-1.5 text-[11px] text-[#5f6d83]">Linhas ocultas no modo Treino até revelar o melhor lance.</p>
        ) : lines.length === 0 ? (
          <p className="px-3 py-1.5 text-[11px] text-[#5f6d83]">{on ? 'Calculando…' : 'Análise pausada.'}</p>
        ) : (
          lines.map((l) => {
            const whiteBetter = evalToNumber(l.scoreWhitePerspective) >= 0
            return (
              <button
                key={l.multipv}
                onClick={() => onPreviewLine?.(l.pv)}
                title="Ver esta linha no tabuleiro"
                className="w-full flex items-center gap-2 px-3 py-[3px] text-left hover:bg-[#2a3648]"
              >
                <span
                  className={`shrink-0 min-w-[46px] text-center rounded-[3px] px-1 py-px font-mono text-[11px] font-bold ${
                    whiteBetter ? 'bg-white text-[#1a2230]' : 'bg-[#403d39] text-white'
                  }`}
                >
                  {formatEval(l.scoreWhitePerspective)}
                </span>
                <span className="truncate text-[12px] text-[#d5dbe5]">{numberedLine(l.san ?? l.pv, currentFen, 10)}</span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
