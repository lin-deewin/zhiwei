import type { ReactNode } from 'react'

type PageHeaderProps = {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return <header className="page-header">
    <div className="page-header-copy">
      <div className="page-eyebrow">{eyebrow}</div>
      <h1>{title}</h1>
      {description && <p className="subtitle">{description}</p>}
    </div>
    {(actions || meta) && <div className="page-header-actions">
      {meta && <div className="page-header-meta">{meta}</div>}
      {actions && <div className="header-actions">{actions}</div>}
    </div>}
  </header>
}
