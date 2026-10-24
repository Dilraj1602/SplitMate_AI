import { AlertCircle, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return <div className="state-row" role="status"><LoaderCircle className="spin" size={18} />{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="feedback feedback-error" role="alert"><AlertCircle size={18} /><span>{message}</span>{onRetry && <button className="text-button" onClick={onRetry}>Try again</button>}</div>
}

export function EmptyState({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="empty-state"><span className="empty-mark" aria-hidden="true">S</span><h2>{title}</h2><p>{children}</p>{action && <div className="empty-action">{action}</div>}</section>
}

export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
  return <div className={`notice notice-${tone}`} role="status">{children}</div>
}
