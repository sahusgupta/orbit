import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GamesExplorer } from '@/src/components/discovery/games-explorer';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { ErrorState, SkeletonList } from '@/src/components/ui/state-panels';
import { getPublicDiscovery } from '@/src/server/public-data';
import { createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = createPageMetadata({
  title: 'Games',
  description: 'Browse running, forming, paused, and scheduled poker games by status, stakes, venue, and distance.',
  path: '/games'
});

export default async function GamesPage() {
  const result = await getPublicDiscovery();
  return <div className="page-shell"><LiveRouteRefresh /><header className="page-intro"><p className="eyebrow">Live game network</p><h1>Games</h1></header>{result.status === 'error' ? <ErrorState message={result.message} /> : <Suspense fallback={<SkeletonList rows={5} />}><GamesExplorer clubs={result.data.clubs} /></Suspense>}</div>;
}
