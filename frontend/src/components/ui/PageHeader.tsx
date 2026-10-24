import type { ReactNode } from 'react'

export function PageHeader({ title, description, eyebrow, action }: {
  title: string
  description?: string
  eyebrow?: string
  action?: ReactNode
}) {
  return <header className="page-header">
    <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>
    {action && <div className="page-actions">{action}</div>}
  </header>
}
