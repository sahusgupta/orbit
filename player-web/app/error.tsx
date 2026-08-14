'use client';

import { ErrorState } from '@/src/components/ui/state-panels';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset(): void }) {
  return <div className="page-shell"><ErrorState message={error.message || 'This Orbit route could not be rendered.'} onRetry={reset} /></div>;
}
