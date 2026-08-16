import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { TournamentsExplorer } from '@/src/components/discovery/tournaments-explorer';
import { ErrorState, SkeletonList } from '@/src/components/ui/state-panels';
import { getPublicDiscovery } from '@/src/server/public-data';
import { createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = createPageMetadata({
  title: 'Tournaments',
  description: 'Browse upcoming poker tournaments by club, buy-in, structure, distance, and registration status.',
  path: '/tournaments',
  noIndex: true
});

export default async function TournamentsPage() {
  const result = await getPublicDiscovery();
  return <div className="page-shell"><LiveRouteRefresh /><header className="page-intro"><p className="eyebrow">Upcoming events</p><h1>Tournaments</h1></header>{result.status === 'error' ? <ErrorState message={result.message} /> : <Suspense fallback={<SkeletonList rows={4} />}><TournamentsExplorer discovery={result.data} /></Suspense>}</div>;
}
