/**
 * A second, strength-limited Stockfish used as a sparring partner. It runs in its own
 * Worker so its UCI_LimitStrength settings never leak into the analysis engine.
 *
 * Strength: Stockfish's UCI_Elo covers 1320–3190; below that we fall back to the
 * coarser "Skill Level" (0–20), which plays noticeably weaker but less human-like.
 */
export const OPPONENT_ELO_MIN = 800
export const OPPONENT_ELO_MAX = 3000

export class OpponentEngine {
  private worker: Worker
  private ready: Promise<void>
  private pending: { resolve: (uci: string) => void; reject: (e: Error) => void } | null = null

  constructor() {
    this.worker = new Worker('/stockfish-19-asm.js')
    this.ready = new Promise((resolve) => {
      const onReady = (e: MessageEvent) => {
        if (String(e.data) === 'readyok') {
          this.worker.removeEventListener('message', onReady)
          resolve()
        }
      }
      this.worker.addEventListener('message', onReady)
    })
    this.worker.addEventListener('message', (e) => {
      const line = String(e.data ?? '')
      if (line.startsWith('bestmove') && this.pending) {
        const uci = line.split(' ')[1]
        const p = this.pending
        this.pending = null
        if (uci && uci !== '(none)') p.resolve(uci)
        else p.reject(new Error('no move'))
      }
    })
    this.send('uci')
    this.send('isready')
  }

  private send(cmd: string) {
    this.worker.postMessage(cmd)
  }

  private configure(elo: number) {
    if (elo >= 1320) {
      this.send('setoption name Skill Level value 20')
      this.send('setoption name UCI_LimitStrength value true')
      this.send(`setoption name UCI_Elo value ${Math.min(3190, Math.round(elo))}`)
    } else {
      this.send('setoption name UCI_LimitStrength value false')
      // 800 → skill 0, ~1300 → skill 5
      this.send(`setoption name Skill Level value ${Math.max(0, Math.min(5, Math.round((elo - 800) / 100)))}`)
    }
  }

  /** Best move (UCI) for `fen` at the given strength. A newer call cancels the previous one. */
  async bestMove(fen: string, elo: number, movetimeMs = 700): Promise<string> {
    await this.ready
    this.cancel()
    this.configure(elo)
    this.send('ucinewgame')
    this.send(`position fen ${fen}`)
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject }
      this.send(`go movetime ${movetimeMs}`)
    })
  }

  cancel() {
    if (this.pending) {
      this.pending.reject(new Error('cancelled'))
      this.pending = null
      this.send('stop')
    }
  }

  destroy() {
    this.cancel()
    this.worker.terminate()
  }
}
