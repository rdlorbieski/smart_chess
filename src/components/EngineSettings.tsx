import { useGame } from '../store/GameContext'

const label = 'uppercase tracking-wider shrink-0 w-14'

/** Analysis caps (depth / time), stop-resume, and the browser-vs-server engine switch. */
export default function EngineSettings() {
  const {
    limits, setLimits, analysisPaused, analysisBusy, stopAnalysis, resumeAnalysis,
    serverEngine, backend, setBackend, infinite, setInfinite, liveDepth,
  } = useGame()

  return (
    <div className="rounded-lg border border-[#2a3648] p-3 space-y-2.5 text-[10px] text-[#8f9db3]">
      <div className="flex items-center justify-between gap-2">
        <span className="uppercase tracking-wider">Motor</span>
        <span className="font-mono text-[#f1f4f8] mr-auto" title="Profundidade de busca alcançada na posição do tabuleiro">
          {liveDepth > 0 ? `profundidade ${liveDepth}` : ''}
          {infinite && analysisBusy && <span className="text-[#81b64c] animate-pulse"> ↑</span>}
        </span>
        <button
          onClick={() => setInfinite(!infinite)}
          className={`px-2 py-1 rounded border ${infinite ? 'border-[#81b64c]/60 text-[#81b64c] bg-[#81b64c]/10' : 'border-[#34435a] hover:bg-[#2a3648]'}`}
          title="Análise infinita: continua pensando na posição do tabuleiro, aprofundando até você mudar de lance ou parar"
        >
          ∞ Infinita
        </button>
        {analysisPaused ? (
          <button onClick={resumeAnalysis} className="px-2 py-1 rounded border border-[#81b64c]/40 text-[#81b64c] hover:bg-[#81b64c]/10">
            ▶ Retomar análise
          </button>
        ) : analysisBusy ? (
          <button onClick={stopAnalysis} className="px-2 py-1 rounded border border-red-500/40 text-red-400 hover:bg-red-500/10">
            ■ Parar análise
          </button>
        ) : (
          <span className="font-mono">ocioso</span>
        )}
      </div>

      <label className="flex items-center gap-2" title="Tempo máximo por posição">
        <span className={label}>Tempo</span>
        <input
          type="range" min={500} max={15000} step={500}
          value={limits.movetimeMs}
          onChange={(e) => setLimits({ movetimeMs: parseInt(e.target.value) })}
          className="flex-1 accent-[#81b64c]"
        />
        <span className="font-mono w-10 text-right">{(limits.movetimeMs / 1000).toFixed(1)}s</span>
      </label>

      <label className="flex items-center gap-2" title="Profundidade máxima de busca por posição">
        <span className={label}>Profund.</span>
        <input
          type="range" min={8} max={30} step={1}
          value={limits.depth}
          onChange={(e) => setLimits({ depth: parseInt(e.target.value) })}
          className="flex-1 accent-[#81b64c]"
        />
        <span className="font-mono w-10 text-right">{limits.depth}</span>
      </label>

      <div className="flex items-center gap-2">
        <span className={label}>Motor em</span>
        <div className="flex rounded border border-[#34435a] overflow-hidden">
          {(['local', 'server'] as const).map((b) => {
            const disabled = b === 'server' && !serverEngine
            return (
              <button
                key={b}
                disabled={disabled}
                onClick={() => setBackend(b)}
                title={disabled ? 'Servidor desligado — inicie com: pnpm server' : undefined}
                className={`px-2.5 py-1 ${backend === b ? 'bg-[#81b64c] text-white' : 'hover:bg-[#2a3648]'} disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {b === 'local' ? 'Navegador' : 'Servidor'}
              </button>
            )
          })}
        </div>
        <span className="font-mono truncate">
          {serverEngine ? (serverEngine === 'native' ? 'Stockfish nativo' : 'Stockfish (Node/WASM)') : 'servidor offline'}
        </span>
      </div>
    </div>
  )
}

/** How much the 2nd best line must lose to flag ONLY MOVE. */
export function ThresholdControl() {
  const { onlyMoveThreshold, setOnlyMoveThreshold } = useGame()
  return (
    <label className="flex items-center gap-2 text-[10px] text-[#8f9db3]" title="Quanto a 2ª melhor linha precisa perder (em pontos de chance de vitória) para marcar LANCE ÚNICO">
      <span className="uppercase tracking-wider shrink-0">Limite do lance único</span>
      <input
        type="range"
        min={5}
        max={40}
        step={1}
        value={Math.round(onlyMoveThreshold * 100)}
        onChange={(e) => setOnlyMoveThreshold(parseInt(e.target.value) / 100)}
        className="flex-1 accent-[#81b64c]"
      />
      <span className="font-mono w-8 text-right">{Math.round(onlyMoveThreshold * 100)}%</span>
    </label>
  )
}
