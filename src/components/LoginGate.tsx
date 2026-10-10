import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { authStatus, login, logout, requestRecoveryCode, verifyRecoveryCode, type AuthStatus } from '../api/auth'

interface AuthContextValue {
  /** Logged-in user, or null when the server runs without a password. */
  user: string | null
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({ user: null, logout: () => {} })
export const useAuth = () => useContext(AuthContext)

// A session can expire while the app is open: any 401 from the API sends us back to the login.
const unauthorizedListeners = new Set<() => void>()
const originalFetch = window.fetch.bind(window)
window.fetch = async (input, init) => {
  const res = await originalFetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
  if (res.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    unauthorizedListeners.forEach((fn) => fn())
  }
  return res
}

type Gate = 'loading' | 'offline' | 'login' | 'open'

/** Shows the login screen until there is a session; the app (and its engine) only mounts after it. */
export default function LoginGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>('loading')
  const [status, setStatus] = useState<AuthStatus | null>(null)
  // Session expired mid-use: keep the app mounted under the login card so the game isn't lost.
  const [keepApp, setKeepApp] = useState(false)

  const check = useCallback(async () => {
    setGate('loading')
    const s = await authStatus()
    setStatus(s)
    // In `pnpm dev` without the API the app still works with the in-browser engine.
    if (!s) setGate(import.meta.env.DEV ? 'open' : 'offline')
    else setGate(!s.enabled || s.user ? 'open' : 'login')
  }, [])

  useEffect(() => {
    check()
    const onUnauthorized = () => {
      setKeepApp(true)
      setGate('login')
    }
    unauthorizedListeners.add(onUnauthorized)
    return () => {
      unauthorizedListeners.delete(onUnauthorized)
    }
  }, [check])

  const doLogout = useCallback(() => {
    logout().finally(() => {
      setStatus((s) => (s ? { ...s, user: null } : s))
      setKeepApp(false)
      setGate('login')
    })
  }, [])

  const app = <AuthContext.Provider value={{ user: status?.user ?? null, logout: doLogout }}>{children}</AuthContext.Provider>
  if (gate === 'open') return app

  const card = (
    <div className="w-full max-w-sm">
      <div className="flex items-center justify-center gap-2 mb-6">
        <span className="text-[#388bfd] text-2xl">♟</span>
        <span className="font-display font-semibold text-xl tracking-tight">ChessMind</span>
      </div>
      <div className="rounded-xl border border-[#21262d] bg-[#161b22] p-6">
        {gate === 'loading' && <p className="text-sm text-[#7d8590] text-center">Carregando…</p>}
        {gate === 'offline' && (
          <div className="flex flex-col gap-4 text-center">
            <p className="text-sm text-[#7d8590]">O servidor não está respondendo.</p>
            <button onClick={check} className={buttonClass}>
              Tentar de novo
            </button>
          </div>
        )}
        {gate === 'login' && (
          <LoginForm
            recovery={status?.recovery ?? null}
            notice={keepApp ? 'Sua sessão expirou. Entre de novo para continuar.' : ''}
            onLoggedIn={(user) => {
              setStatus((s) => (s ? { ...s, user } : s))
              setGate('open')
            }}
          />
        )}
      </div>
    </div>
  )

  if (keepApp && gate === 'login') {
    return (
      <>
        {app}
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 text-[#e6edf3]">{card}</div>
      </>
    )
  }
  return <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex items-center justify-center px-4">{card}</div>
}

const inputClass =
  'w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-2 text-sm text-[#e6edf3] outline-none focus:border-[#388bfd]'
const buttonClass =
  'w-full rounded-md bg-[#388bfd] px-3 py-2 text-sm font-medium text-white hover:bg-[#4493f8] disabled:opacity-50 disabled:cursor-not-allowed'
const linkClass = 'text-xs text-[#7d8590] hover:text-[#e6edf3] underline-offset-2 hover:underline disabled:opacity-50'

function LoginForm({
  recovery,
  notice,
  onLoggedIn,
}: {
  recovery: string | null
  notice: string
  onLoggedIn: (user: string) => void
}) {
  const [mode, setMode] = useState<'password' | 'code'>('password')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const submitPassword = (e: FormEvent) => {
    e.preventDefault()
    run(async () => onLoggedIn((await login(user, password)).user))
  }

  const sendCode = () =>
    run(async () => {
      setSentTo((await requestRecoveryCode()).sentTo)
      setCode('')
      setMode('code')
    })

  const submitCode = (e: FormEvent) => {
    e.preventDefault()
    run(async () => onLoggedIn((await verifyRecoveryCode(code)).user))
  }

  if (mode === 'code') {
    return (
      <form onSubmit={submitCode} className="flex flex-col gap-3">
        <p className="text-sm text-[#7d8590]">
          Enviamos um código de 6 dígitos para <span className="text-[#e6edf3]">{sentTo}</span>. Ele vale por 10 minutos.
        </p>
        <input
          className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        {error && <p className="text-xs text-[#f85149]">{error}</p>}
        <button type="submit" disabled={busy || code.length !== 6} className={buttonClass}>
          Entrar com o código
        </button>
        <div className="flex justify-between">
          <button type="button" className={linkClass} onClick={() => (setMode('password'), setError(''))}>
            Voltar
          </button>
          <button type="button" className={linkClass} disabled={busy} onClick={sendCode}>
            Reenviar código
          </button>
        </div>
      </form>
    )
  }

  return (
    <form onSubmit={submitPassword} className="flex flex-col gap-3">
      {notice && <p className="text-xs text-amber-400">{notice}</p>}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#7d8590]">Usuário</span>
        <input className={inputClass} autoComplete="username" autoFocus value={user} onChange={(e) => setUser(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[#7d8590]">Senha</span>
        <input
          className={inputClass}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p className="text-xs text-[#f85149]">{error}</p>}
      <button type="submit" disabled={busy || !user || !password} className={buttonClass}>
        Entrar
      </button>
      {recovery && (
        <button type="button" className={`${linkClass} self-center`} disabled={busy} onClick={sendCode}>
          Esqueci a senha — enviar código para {recovery}
        </button>
      )}
    </form>
  )
}
