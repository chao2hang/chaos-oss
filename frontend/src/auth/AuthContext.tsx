import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { User } from '../api/types'
import {
  rawLogin,
  staticHash,
  clearTokens,
  ensureFreshToken,
  getAccessToken,
  getRefreshToken,
  request,
  setTokens,
  SESSION_EXPIRED_EVENT,
} from '../api/client'

interface AuthState {
  user: User | null
  /** true until the initial /me check finishes */
  initializing: boolean
  login: (username: string, password: string, otp?: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [initializing, setInitializing] = useState(true)

  // Boot: proactively refresh a near-expiry token, then load the user.
  useEffect(() => {
    let alive = true
    const boot = async () => {
      if (!getAccessToken() && !getRefreshToken()) {
        setInitializing(false)
        return
      }
      try {
        await ensureFreshToken()
        const me = await request<User>('/api/me')
        if (alive) setUser(me)
      } catch {
        clearTokens()
        if (alive) setUser(null)
      } finally {
        if (alive) setInitializing(false)
      }
    }
    void boot()
    return () => {
      alive = false
    }
  }, [])

  // Reactive: any request that failed to refresh broadcasts this event.
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      const current = window.location.pathname
      if (!current.startsWith('/login')) {
        nav(`/login?redirect=${encodeURIComponent(current)}`, { replace: true })
      }
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [nav])

  const login = useCallback(
    async (username: string, password: string, otp?: string) => {
      // Hashed endpoint keeps the plaintext password off the wire when
      // WebCrypto is available; otherwise fall back to the legacy
      // plaintext endpoint (plain HTTP on a LAN IP has no crypto.subtle).
      let resp
      if (window.crypto?.subtle) {
        const hashed = await staticHash(password)
        resp = await rawLogin('/api/auth/login/hash', {
          username,
          password: hashed,
          otp_code: otp ?? '',
        })
      } else {
        resp = await rawLogin('/api/auth/login', {
          username,
          password,
          otp_code: otp ?? '',
        })
      }
      setTokens(resp.token, resp.refresh_token)
      const me = await request<User>('/api/me')
      setUser(me)
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      // Best effort server-side invalidation of both tokens.
      await request('/api/auth/logout', {
        method: 'POST',
        body: { refresh_token: getRefreshToken() },
      })
    } catch {
      /* token may already be dead — ignore */
    }
    clearTokens()
    setUser(null)
    nav('/login', { replace: true })
  }, [nav])

  const value = useMemo(
    () => ({ user, initializing, login, logout }),
    [user, initializing, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
