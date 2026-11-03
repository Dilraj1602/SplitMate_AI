import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type QuickActionPreferences = {
  position: 'right' | 'left'
  size: 'small' | 'medium' | 'large'
  visible: boolean
  animate: boolean
  reduceMotion: boolean
}

const KEY = 'splitmate.quick-actions.preferences.v1'
const defaults: QuickActionPreferences = { position: 'right', size: 'medium', visible: true, animate: true, reduceMotion: false }
const PreferencesContext = createContext<{ preferences: QuickActionPreferences; update: (value: Partial<QuickActionPreferences>) => void } | null>(null)

function readPreferences(): QuickActionPreferences {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return defaults
    const value = parsed as Partial<QuickActionPreferences>
    return {
      position: value.position === 'left' ? 'left' : 'right',
      size: value.size === 'small' || value.size === 'large' ? value.size : 'medium',
      visible: typeof value.visible === 'boolean' ? value.visible : defaults.visible,
      animate: typeof value.animate === 'boolean' ? value.animate : defaults.animate,
      reduceMotion: typeof value.reduceMotion === 'boolean' ? value.reduceMotion : defaults.reduceMotion,
    }
  } catch { return defaults }
}

export function QuickActionPreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<QuickActionPreferences>(readPreferences)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(preferences)) } catch { /* Preferences still work for this session. */ }
  }, [preferences])
  const value = useMemo(() => ({
    preferences,
    update: (change: Partial<QuickActionPreferences>) => setPreferences(current => ({ ...current, ...change })),
  }), [preferences])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function useQuickActionPreferences() {
  const context = useContext(PreferencesContext)
  if (!context) throw new Error('Quick action preferences must be used inside their provider.')
  return context
}
