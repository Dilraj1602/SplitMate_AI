import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { setAccessToken } from '../services/api'

type AuthContextValue = { authenticated: boolean; startSession: (token: string) => void; endSession: () => void }
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>()
  const value = useMemo<AuthContextValue>(() => ({
    authenticated: Boolean(token),
    startSession: (nextToken: string) => { setAccessToken(nextToken); setToken(nextToken) },
    endSession: () => { setAccessToken(undefined); setToken(undefined) },
  }), [token])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}
