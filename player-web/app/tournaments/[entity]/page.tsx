import { CalendarDays, Clock3, Coins, MapPin, RotateCcw, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TournamentAction } from '@/src/components/actions/tournament-action';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { StructuredData } from '@/src/components/seo/structured-data';
import { ButtonLink } from '@/src/components/ui/button';
import { ErrorState } from '@/src/components/ui/state-panels';
import { StatusBadge } from '@/src/components/ui/status-badge';
import { clubRouteKey, findTournamentByRouteKey, formatBuyIn, formatEventDate, formatTournamentAddOns, formatTournamentRebuys, getTournamentInterestLabel, getTournamentInterestState, getTournamentInterestTimingLabel, tournamentRouteKey } from '@/src/domain/selectors';
import type { PlayerTournament } from '@/src/domain/types';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
type TournamentPageProps = { params: Promise<{ entity: string }> };

function entrantLabel(entrantCount: number | undefined) {
  return entrantCount == null
    ? 'Entrants unavailable'
    : `${entrantCount} venue-reported entrant${entrantCount === 1 ? '' : 's'}`;
}

function activityLabel(tournament: PlayerTournament) {
  const activity = [
    tournament.totalRebuys == null ? null : `${tournament.totalRebuys} rebuys`,
    tournament.totalAddOns == null ? null : `${tournament.totalAddOns} add-ons`
  ].filter((value): value is string => Boolean(value));
  return activity.length ? activity.join(' · ') : 'Not published';
}

export async function generateMetadata({ params }: TournamentPageProps): Promise<Metadata> {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  const tournament = result.status === 'ready' ? findTournamentByRouteKey(result.data, entity) : undefined;
  const club = tournament && result.status === 'ready' ? result.data.clubs.find((candidate) => candidate.club.id === tournament.clubId) : undefined;
  if (!tournament) return createPageMetadata({ title: 'Poker tournament', description: 'Poker tournament details published through Orbit.', path: `/tournaments/${entity}`, noIndex: true });
  const title = `${tournament.name}${club ? ` at ${club.club.name}` : ''}`;
  const description = `${formatEventDate(tournament.startsAt)}. ${formatBuyIn(tournament)}. ${getTournamentInterestLabel(tournament)}.`;
  return createPageMetadata({ title, description, path: `/tournaments/${tournamentRouteKey(club, tournament)}`, noIndex: true });
}

export default async function TournamentDetailPage({ params }: TournamentPageProps) {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  if (result.status === 'error') return <div className="page-shell"><ErrorState message={result.message} /></div>;
  const tournament = findTournamentByRouteKey(result.data, entity);
  if (!tournament) notFound();
  const club = result.data.clubs.find((candidate) => candidate.club.id === tournament.clubId);
  const interestOpen = getTournamentInterestState(tournament) === 'open';
  const path = `/tournaments/${tournamentRouteKey(club, tournament)}`;
  return (
    <div className="page-shell detail-page">
      <StructuredData data={{
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: tournament.name,
        url: absoluteUrl(path),
        startDate: tournament.startsAt,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: club ? {
          '@type': 'Place',
          name: club.club.name,
          address: club.club.address || undefined
        } : undefined
      }} />
      <LiveRouteRefresh tournaments={[tournament]} />
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ButtonLink href="/tournaments" tone="quiet" size="compact">Tournaments</ButtonLink><span aria-hidden="true">/</span><span>{tournament.name}</span></nav>
      <section className="detail-hero tournament-hero">
        <div className="detail-hero__main">
          <StatusBadge tone={interestOpen ? 'success' : 'neutral'}>{getTournamentInterestLabel(tournament)}</StatusBadge>
          <p className="eyebrow">{club?.club.name ?? 'Venue unavailable'}</p>
          <h1>{tournament.name}</h1>
          <p className="detail-hero__lead">{formatEventDate(tournament.startsAt)} · {formatBuyIn(tournament)}</p>
          <div className="detail-facts"><span><MapPin aria-hidden="true" />{club?.club.address || 'Location unavailable'}</span><span><UsersRound aria-hidden="true" />{entrantLabel(tournament.entrantCount)}</span><span><Clock3 aria-hidden="true" />{getTournamentInterestTimingLabel(tournament)}</span></div>
        </div>
        <TournamentAction club={club} tournament={tournament} />
      </section>
      <div className="tournament-structure-grid">
        <article><Coins aria-hidden="true" /><span>Venue-listed prize</span><strong>{tournament.prizePoolLabel?.trim() || 'Not published'}</strong></article>
        <article><CalendarDays aria-hidden="true" /><span>Starting stack</span><strong>{tournament.startingStack == null ? 'Not published' : tournament.startingStack.toLocaleString()}</strong></article>
        <article><Clock3 aria-hidden="true" /><span>Blind levels</span><strong>{tournament.levelMinutes == null ? 'Not published' : `${tournament.levelMinutes} minutes`}</strong></article>
        <article><UsersRound aria-hidden="true" /><span>Venue-reported entrants</span><strong>{tournament.entrantCount == null ? 'Not published' : tournament.entrantCount}</strong></article>
      </div>
      <div className="detail-grid">
        <section className="detail-section">
          <header><p className="eyebrow">Event structure</p><h2>Review the venue-published format.</h2></header>
          <dl className="definition-list">
            <div><dt>Late-entry cutoff</dt><dd>{tournament.lateRegistrationThroughLevel == null ? 'Not published' : `Venue lists level ${tournament.lateRegistrationThroughLevel}`}</dd></div>
            <div><dt>Rebuys</dt><dd>{formatTournamentRebuys(tournament)}</dd></div>
            <div><dt>Add-on</dt><dd>{formatTournamentAddOns(tournament)}</dd></div>
            <div><dt>Venue-reported activity</dt><dd>{activityLabel(tournament)}</dd></div>
            <div><dt>Interest withdrawal</dt><dd>{tournament.withdrawalAllowed ? 'Available before the event starts' : 'Not available through Orbit'}</dd></div>
          </dl>
        </section>
        <aside className="rules-panel"><RotateCcw aria-hidden="true" /><p className="eyebrow">Rules</p><h2>House and event rules</h2>{tournament.rules.length ? <ul>{tournament.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p>No venue rules have been published.</p>}{club ? <ButtonLink href={`/clubs/${clubRouteKey(club)}`} tone="secondary">View host club</ButtonLink> : null}</aside>
      </div>
    </div>
  );
}
