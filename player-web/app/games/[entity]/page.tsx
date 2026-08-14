import { Clock3, MapPin, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GameAction } from '@/src/components/actions/game-action';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { StructuredData } from '@/src/components/seo/structured-data';
import { ButtonLink } from '@/src/components/ui/button';
import { ErrorState } from '@/src/components/ui/state-panels';
import { StatusBadge } from '@/src/components/ui/status-badge';
import { clubRouteKey, findGameByRouteKey, formatEventDate, gameRouteKey, getGameState, getGameStateLabel, getStakesLabel } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';

type GamePageProps = { params: Promise<{ entity: string }> };

export async function generateMetadata({ params }: GamePageProps): Promise<Metadata> {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  const listing = result.status === 'ready' ? findGameByRouteKey(result.data.clubs, entity) : undefined;
  if (!listing) return createPageMetadata({ title: 'Poker game', description: 'Current live poker game details from Orbit.', path: `/games/${entity}` });
  const title = `${listing.game.name} at ${listing.club.club.name}`;
  const description = `${getGameStateLabel(getGameState(listing.game))}. ${listing.game.availableSeats} open seats and ${listing.game.waitlistCount} waiting.`;
  return createPageMetadata({ title, description, path: `/games/${gameRouteKey(listing.club, listing.game)}` });
}

export default async function GameDetailPage({ params }: GamePageProps) {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  if (result.status === 'error') return <div className="page-shell"><ErrorState message={result.message} /></div>;
  const listing = findGameByRouteKey(result.data.clubs, entity);
  if (!listing) notFound();
  const { club, game } = listing;
  const state = getGameState(game);
  const path = `/games/${gameRouteKey(club, game)}`;
  return (
    <div className="page-shell detail-page">
      <StructuredData data={{
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: `${game.name} at ${club.club.name}`,
        url: absoluteUrl(path),
        description: `${getGameStateLabel(state)} with ${game.availableSeats} open seats and ${game.waitlistCount} waiting or interested.`,
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
          <p className="detail-hero__lead">{getStakesLabel(game)} · {game.collectionMode === 'Time' ? 'Time collection' : 'House drop'} · {game.openTables.length || 'No'} active table{game.openTables.length === 1 ? '' : 's'}</p>
          <div className="detail-facts"><span><UsersRound aria-hidden="true" />{game.availableSeats} open seats</span><span><Clock3 aria-hidden="true" />{game.waitlistCount} waiting or interested</span><span><MapPin aria-hidden="true" />{club.club.address || 'Club location available'}</span></div>
        </div>
        <GameAction club={club} game={game} />
      </section>
      <div className="detail-grid">
        <section className="detail-section"><header><p className="eyebrow">Live floor</p><h2>Tables and demand</h2></header>{game.openTables.length ? <div className="table-list">{game.openTables.map((table) => <article key={table.id}><div><StatusBadge tone={table.status === 'Running' ? 'live' : table.status === 'Forming' ? 'forming' : 'warning'}>{table.status}</StatusBadge><h3>{table.label}</h3><p>Started {formatEventDate(table.startedAt)}</p></div><dl><div><dt>Seats</dt><dd>{table.seatsFilled}/{table.maxSeats}</dd></div><div><dt>Available</dt><dd>{table.availableSeats}</dd></div><div><dt>Collection</dt><dd>{table.collectionMode}</dd></div></dl></article>)}</div> : <div className="notice-box"><strong>No active table published</strong><p>This game remains discoverable as scheduled inventory. The club will publish live or forming status through Orbit Core.</p></div>}</section>
        <aside className="detail-aside"><p className="eyebrow">Host venue</p><h2>{club.club.name}</h2><p>{club.club.address || 'Location details are managed by the club.'}</p><dl><div><dt>Players in house</dt><dd>{club.social.activePlayerCount}</dd></div><div><dt>Total waitlist</dt><dd>{club.social.waitlistCount}</dd></div><div><dt>Games offered</dt><dd>{club.games.length}</dd></div></dl><ButtonLink href={`/clubs/${clubRouteKey(club)}`} tone="secondary">View club</ButtonLink></aside>
      </div>
    </div>
  );
}
