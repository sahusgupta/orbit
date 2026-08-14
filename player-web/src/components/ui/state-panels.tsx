import { AlertCircle, Inbox, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function SectionHeading({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <header className="section-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <section className="state-panel" aria-live="polite">
      <Inbox aria-hidden="true" size={24} />
      <div><h2>{title}</h2><p>{message}</p></div>
      {action}
    </section>
  );
}

export function ErrorState({ title = 'Something interrupted the live feed', message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <section className="state-panel state-panel--error" role="alert">
      <AlertCircle aria-hidden="true" size={24} />
      <div><h2>{title}</h2><p>{message}</p></div>
      {onRetry ? <Button tone="secondary" onClick={onRetry}><RotateCcw aria-hidden="true" size={16} />Retry</Button> : null}
    </section>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading live Orbit data">
      {Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /></div>)}
    </div>
  );
}
