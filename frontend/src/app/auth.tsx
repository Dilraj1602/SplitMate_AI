import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, ApiError, setAccessToken } from '../services/api'

type AuthContextValue = { authenticated: boolean; loading: boolean; startSession: (token: string) => void; endSession: () => void }
const AuthContext = createContext<AuthContextValue | null>(null)
const SESSION_KEY = 'splitmate_access_token'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    const clearSession = () => {
      setAccessToken(undefined)
      setToken(undefined)
      try { window.sessionStorage.removeItem(SESSION_KEY) } catch { /* Ignore unavailable storage. */ }
    }
    window.addEventListener('splitmate:unauthorized', clearSession)
    let stored: string | null = null
    try { stored = window.sessionStorage.getItem(SESSION_KEY) } catch { /* Storage may be disabled. */ }
    if (!stored) { setLoading(false); return () => { active = false; window.removeEventListener('splitmate:unauthorized', clearSession) } }
    setAccessToken(stored)
    void api.get('/auth/me').then(() => {
      if (active) setToken(stored || undefined)
    }).catch((cause: unknown) => {
      if (cause instanceof ApiError && cause.status === 401) {
        setAccessToken(undefined)
        try { window.sessionStorage.removeItem(SESSION_KEY) } catch { /* Ignore unavailable storage. */ }
      } else if (active) {
        // Keep the saved session when restoration is blocked by a temporary network failure.
        setToken(stored || undefined)
      }
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; window.removeEventListener('splitmate:unauthorized', clearSession) }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    authenticated: Boolean(token),
    loading,
    startSession: (nextToken: string) => {
      setAccessToken(nextToken)
      try { window.sessionStorage.setItem(SESSION_KEY, nextToken) } catch { /* Keep the current tab signed in. */ }
      setToken(nextToken)
      setLoading(false)
    },
    endSession: () => {
      setAccessToken(undefined)
      try { window.sessionStorage.removeItem(SESSION_KEY) } catch { /* Ignore unavailable storage. */ }
      setToken(undefined)
      setLoading(false)
    },
  }), [token, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
