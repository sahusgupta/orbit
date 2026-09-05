import { MapPin, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameAction } from '@/src/components/actions/game-action';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { PublishedGameTables } from '@/src/components/discovery/published-game-tables';
import { StructuredData } from '@/src/components/seo/structured-data';
import { ButtonLink } from '@/src/components/ui/button';
import { ErrorState } from '@/src/components/ui/state-panels';
import { StatusBadge } from '@/src/components/ui/status-badge';
import { clubRouteKey, findGameByRouteKey, gameRouteKey, getGameAvailabilityLabel, getGameState, getGameStateLabel, getStakesLabel } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';

type GamePageProps = { params: Promise<{ entity: string }> };

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  const listing = result.status === 'ready' ? findGameByRouteKey(result.data.clubs, entity) : undefined;
  if (!listing) return createPageMetadata({ title: 'Poker game', description: 'Poker game details published through Orbit.', path: `/games/${entity}`, noIndex: true });
  const title = `${listing.game.name} at ${listing.club.club.name}`;
  const description = `${getGameStateLabel(getGameState(listing.game))}. ${getGameAvailabilityLabel(listing.game)}.`;
  return createPageMetadata({ title, description, path: `/games/${gameRouteKey(listing.club, listing.game)}`, noIndex: true });
}

export default async function GameDetailPage({ params }: GamePageProps) {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  if (result.status === 'error') return <div className="page-shell"><ErrorState message={result.message} /></div>;
  const listing = findGameByRouteKey(result.data.clubs, entity);
  if (!listing) notFound();
  const { club, game } = listing;
  const state = getGameState(game);
  const availability = getGameAvailabilityLabel(game);
  const collection = game.collectionMode === 'Time'
    ? 'Time collection'
    : game.collectionMode === 'Drop'
      ? 'House drop'
      : 'Collection unavailable';
  const path = `/games/${gameRouteKey(club, game)}`;
  return (
    <div className="page-shell detail-page">
      <StructuredData data={{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `${game.name} at ${club.club.name}`,
        url: absoluteUrl(path),
        description: `${getGameStateLabel(state)}. ${availability}.`,
        about: {
          '@type': 'SportsActivityLocation',
          name: club.club.name,
          address: club.club.address || undefined,
          telephone: club.club.phone || undefined,
          url: absoluteUrl(`/clubs/${clubRouteKey(club)}`)
        }
      }} />
      <LiveRouteRefresh />
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ButtonLink href="/games" tone="quiet" size="compact">Games</ButtonLink><span aria-hidden="true">/</span><span>{game.name}</span></nav>
      <section className="detail-hero">
        <div className="detail-hero__main">
          <StatusBadge tone={state === 'running' ? 'live' : state === 'forming' ? 'forming' : 'neutral'}>{getGameStateLabel(state)}</StatusBadge>
          <p className="eyebrow">{club.club.name}</p>
          <h1>{game.name}</h1>
          <p className="detail-hero__lead">{getStakesLabel(game)} · {collection} · {game.openTables.length || 'No'} published table{game.openTables.length === 1 ? '' : 's'}</p>
          <div className="detail-facts"><span><UsersRound aria-hidden="true" />{availability}</span><span><MapPin aria-hidden="true" />{club.club.address || 'Location unavailable'}</span></div>
        </div>
        <GameAction club={club} game={game} />
      </section>
      <div className="detail-grid">
        <section className="detail-section"><header><p className="eyebrow">Published floor</p><h2>Tables and demand</h2></header><PublishedGameTables tables={game.openTables} /></section>
        <aside className="detail-aside"><p className="eyebrow">Host venue</p><h2>{club.club.name}</h2><p>{club.club.address || 'Location unavailable'}</p><dl><div><dt>Players in house</dt><dd>{club.social?.activePlayerCount ?? 'Unavailable'}</dd></div><div><dt>Total waitlist</dt><dd>{club.social?.waitlistCount ?? 'Unavailable'}</dd></div><div><dt>Games offered</dt><dd>{club.games.length}</dd></div></dl><ButtonLink href={`/clubs/${clubRouteKey(club)}`} tone="secondary">View club</ButtonLink></aside>
      </div>
    </div>
  );
}
