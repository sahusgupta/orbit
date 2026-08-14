import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ClubsExplorer } from '@/src/components/discovery/clubs-explorer';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { ErrorState, SkeletonList } from '@/src/components/ui/state-panels';
import { getPublicDiscovery } from '@/src/server/public-data';
import { createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = createPageMetadata({
  title: 'Clubs',
  description: 'Find participating poker clubs by area, current games, forming activity, and upcoming tournaments.',
  path: '/clubs'
});

export default async function ClubsPage() {
  const result = await getPublicDiscovery();
  return <div className="page-shell"><LiveRouteRefresh /><header className="page-intro"><p className="eyebrow">Orbit network</p><h1>Clubs</h1></header>{result.status === 'error' ? <ErrorState message={result.message} /> : <Suspense fallback={<SkeletonList rows={4} />}><ClubsExplorer clubs={result.data.clubs} /></Suspense>}</div>;
}
