export interface AuthStatus {
  enabled: boolean
  user: string | null
  /** Masked recovery e-mail, or null when the server can't send codes. */
  recovery: string | null
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Erro do servidor (${res.status})`)
  return body as T
}

const post = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })

/** null = server unreachable. */
export async function authStatus(): Promise<AuthStatus | null> {
  try {
    const res = await fetch('/api/auth/me')
    return res.ok ? ((await res.json()) as AuthStatus) : null
  } catch {
    return null
  }
}

export const login = (user: string, password: string) =>
  post('/api/auth/login', { user, password }).then((r) => json<{ user: string }>(r))

export const logout = () => post('/api/auth/logout').then((r) => json<{ ok: boolean }>(r))

export const requestRecoveryCode = () => post('/api/auth/recover').then((r) => json<{ sentTo: string }>(r))

export const verifyRecoveryCode = (code: string) =>
  post('/api/auth/recover/verify', { code }).then((r) => json<{ user: string }>(r))
