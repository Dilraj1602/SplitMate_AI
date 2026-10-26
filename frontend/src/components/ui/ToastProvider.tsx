import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react'

type ToastKind = 'success' | 'error' | 'warning' | 'info'
type ToastItem = { id: number; kind: ToastKind; message: string }
type ToastApi = { success: (message: string) => void; error: (message: string) => void; warning: (message: string) => void; info: (message: string) => void }
const noop = () => undefined
const ToastContext = createContext<ToastApi>({ success: noop, error: noop, warning: noop, info: noop })
const iconByKind = { success: CheckCircle2, error: AlertCircle, warning: TriangleAlert, info: Info }

function ToastCard({ item, dismiss }: { item: ToastItem; dismiss: (id: number) => void }) {
  const Icon = iconByKind[item.kind]
  const duration = item.kind === 'error' ? 7000 : 4500
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(item.id), duration)
    return () => window.clearTimeout(timer)
  }, [dismiss, duration, item.id])
  return <div className={`toast-card toast-${item.kind}`} role={item.kind === 'error' ? 'alert' : 'status'} aria-live={item.kind === 'error' ? 'assertive' : 'polite'}>
    <Icon size={19} aria-hidden="true"/><span>{item.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}><X size={17}/></button>
  </div>
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)
  const dismiss = useCallback((id: number) => setItems(current => current.filter(item => item.id !== id)), [])
  const add = useCallback((kind: ToastKind, message: string) => {
    const clean = message.trim()
    if (!clean) return
    setItems(current => {
      if (current.some(item => item.kind === kind && item.message === clean)) return current
      return [...current, { id: ++nextId.current, kind, message: clean }].slice(-4)
    })
  }, [])
  const api = useMemo<ToastApi>(() => ({
    success: message => add('success', message),
    error: message => add('error', message),
    warning: message => add('warning', message),
    info: message => add('info', message),
  }), [add])
  return <ToastContext.Provider value={api}>{children}<div className="toast-region" aria-label="Notifications">{items.map(item => <ToastCard key={item.id} item={item} dismiss={dismiss}/>)}</div></ToastContext.Provider>
}

export function useToast() { return useContext(ToastContext) }
