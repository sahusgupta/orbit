import type { ReactNode } from 'react';

export type StatusTone = 'live' | 'forming' | 'neutral' | 'success' | 'warning' | 'danger';

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: StatusTone }) {
  return <span className={`status-badge status-badge--${tone}`}><span aria-hidden="true" className="status-badge__dot" />{children}</span>;
}
