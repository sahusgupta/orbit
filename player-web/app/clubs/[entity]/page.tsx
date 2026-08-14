import { MapPin, Phone, Radio } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ClubMembershipAction } from '@/src/components/actions/club-membership-action';
import { GameCard, TournamentCard } from '@/src/components/discovery/entity-cards';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { StructuredData } from '@/src/components/seo/structured-data';
import { ButtonLink } from '@/src/components/ui/button';
import { EmptyState, ErrorState, SectionHeading } from '@/src/components/ui/state-panels';
import { clubRouteKey, filterTournaments, findClubByRouteKey, flattenGames, getVenueLabel } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
type ClubPageProps = { params: Promise<{ entity: string }> };

export async function generateMetadata({ params }: ClubPageProps): Promise<Metadata> {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  const club = result.status === 'ready' ? findClubByRouteKey(result.data.clubs, entity) : undefined;
  if (!club) return createPageMetadata({ title: 'Poker club', description: 'Live poker club details from Orbit.', path: `/clubs/${entity}` });
  const description = `${club.games.length} games and current activity at ${club.club.name}${club.club.address ? `, ${club.club.address}` : ''}.`;
  return createPageMetadata({ title: club.club.name, description, path: `/clubs/${clubRouteKey(club)}` });
}

export default async function ClubDetailPage({ params }: ClubPageProps) {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  if (result.status === 'error') return <div className="page-shell"><ErrorState message={result.message} /></div>;
  const club = findClubByRouteKey(result.data.clubs, entity);
  if (!club) notFound();
  const games = flattenGames([club]);
  const tournaments = filterTournaments(result.data, { query: '', club: club.club.id, distance: '0', registration: 'all' });
  const runningCount = games.filter((listing) => listing.state === 'running').length;
  const formingCount = games.filter((listing) => listing.state === 'forming').length;
  const path = `/clubs/${clubRouteKey(club)}`;
  return (
    <div className="page-shell detail-page">
      <StructuredData data={{
        '@context': 'https://schema.org',
        '@type': 'SportsActivityLocation',
        name: club.club.name,
        url: absoluteUrl(path),
        address: club.club.address || undefined,
        telephone: club.club.phone || undefined,
        description: `${runningCount} running games, ${formingCount} forming games, and ${tournaments.length} upcoming tournaments published through Orbit.`
      }} />
      <LiveRouteRefresh />
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ButtonLink href="/clubs" tone="quiet" size="compact">Clubs</ButtonLink><span aria-hidden="true">/</span><span>{club.club.name}</span></nav>
      <section className="club-hero">
        <div className="club-hero__identity"><span className="club-monogram club-monogram--large" aria-hidden="true">{club.club.name.slice(0, 1).toUpperCase()}</span><div><p className="eyebrow">{getVenueLabel(club)}</p><h1>{club.club.name}</h1><p><MapPin aria-hidden="true" />{club.club.address || 'Location managed by the club'}</p>{club.club.phone ? <a href={`tel:${club.club.phone}`}><Phone aria-hidden="true" />{club.club.phone}</a> : null}</div></div>
        <div className="club-live-strip"><div><span className="live-indicator" aria-hidden="true" /><strong>{runningCount}</strong><small>running</small></div><div><Radio aria-hidden="true" /><strong>{formingCount}</strong><small>forming</small></div><div><strong>{tournaments.length}</strong><small>upcoming</small></div></div>
      </section>
      <div className="detail-grid detail-grid--club">
        <div className="stack-2xl">
          <section><SectionHeading eyebrow="What is running" title="Games at this club" />{games.length ? <div className="entity-list">{games.map((listing) => <GameCard key={listing.game.id} listing={listing} />)}</div> : <EmptyState title="No games published" message="The club has not published game inventory yet." />}</section>
          <section><SectionHeading eyebrow="What is upcoming" title="Tournaments" />{tournaments.length ? <div className="tournament-list">{tournaments.map((listing) => <TournamentCard key={listing.tournament.id} listing={listing} compact />)}</div> : <EmptyState title="No tournaments scheduled" message="Upcoming events will appear when this club publishes them." />}</section>
        </div>
        <aside><ClubMembershipAction club={club} /></aside>
      </div>
    </div>
  );
}
