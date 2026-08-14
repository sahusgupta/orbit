import { CalendarDays, Clock3, Coins, MapPin, RotateCcw, UsersRound } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { TournamentAction } from '@/src/components/actions/tournament-action';
import { LiveRouteRefresh } from '@/src/components/discovery/live-route-refresh';
import { StructuredData } from '@/src/components/seo/structured-data';
import { ButtonLink } from '@/src/components/ui/button';
import { ErrorState } from '@/src/components/ui/state-panels';
import { StatusBadge } from '@/src/components/ui/status-badge';
import { clubRouteKey, findTournamentByRouteKey, formatBuyIn, formatEventDate, tournamentRouteKey } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl, createPageMetadata } from '@/src/seo/site';

export const dynamic = 'force-dynamic';
type TournamentPageProps = { params: Promise<{ entity: string }> };

export async function generateMetadata({ params }: TournamentPageProps): Promise<Metadata> {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  const tournament = result.status === 'ready' ? findTournamentByRouteKey(result.data, entity) : undefined;
  const club = tournament && result.status === 'ready' ? result.data.clubs.find((candidate) => candidate.club.id === tournament.clubId) : undefined;
  if (!tournament) return createPageMetadata({ title: 'Poker tournament', description: 'Live poker tournament details from Orbit.', path: `/tournaments/${entity}` });
  const title = `${tournament.name}${club ? ` at ${club.club.name}` : ''}`;
  const description = `${formatEventDate(tournament.startsAt)}. ${formatBuyIn(tournament)}. Registration ${tournament.registrationStatus}.`;
  return createPageMetadata({ title, description, path: `/tournaments/${tournamentRouteKey(club, tournament)}` });
}

export default async function TournamentDetailPage({ params }: TournamentPageProps) {
  const { entity } = await params;
  const result = await getPublicDiscovery();
  if (result.status === 'error') return <div className="page-shell"><ErrorState message={result.message} /></div>;
  const tournament = findTournamentByRouteKey(result.data, entity);
  if (!tournament) notFound();
  const club = result.data.clubs.find((candidate) => candidate.club.id === tournament.clubId);
  const registrationOpen = tournament.registrationStatus === 'open';
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
        eventStatus: 'https://schema.org/EventScheduled',
        location: club ? {
          '@type': 'Place',
          name: club.club.name,
          address: club.club.address || undefined
        } : undefined,
        offers: {
          '@type': 'Offer',
          price: tournament.buyIn,
          priceCurrency: 'USD',
          availability: registrationOpen ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
          url: absoluteUrl(path),
          validFrom: tournament.registrationOpensAt,
          validThrough: tournament.registrationClosesAt
        }
      }} />
      <LiveRouteRefresh />
      <nav className="breadcrumbs" aria-label="Breadcrumb"><ButtonLink href="/tournaments" tone="quiet" size="compact">Tournaments</ButtonLink><span aria-hidden="true">/</span><span>{tournament.name}</span></nav>
      <section className="detail-hero tournament-hero">
        <div className="detail-hero__main">
          <StatusBadge tone={registrationOpen ? 'success' : 'neutral'}>{registrationOpen ? 'Registration open' : 'Registration closed'}</StatusBadge>
          <p className="eyebrow">{club?.club.name ?? 'Orbit tournament'}</p>
          <h1>{tournament.name}</h1>
          <p className="detail-hero__lead">{formatEventDate(tournament.startsAt)} · {formatBuyIn(tournament)}</p>
          <div className="detail-facts"><span><MapPin aria-hidden="true" />{club?.club.address || 'Host location available'}</span><span><UsersRound aria-hidden="true" />{tournament.entrantCount} entrants</span><span><Clock3 aria-hidden="true" />Registration closes {formatEventDate(tournament.registrationClosesAt)}</span></div>
        </div>
        <TournamentAction club={club} tournament={tournament} />
      </section>
      <div className="tournament-structure-grid">
        <article><Coins aria-hidden="true" /><span>Prize</span><strong>{tournament.prizePoolLabel}</strong></article>
        <article><CalendarDays aria-hidden="true" /><span>Starting stack</span><strong>{tournament.startingStack.toLocaleString()}</strong></article>
        <article><Clock3 aria-hidden="true" /><span>Blind levels</span><strong>{tournament.levelMinutes} minutes</strong></article>
        <article><UsersRound aria-hidden="true" /><span>Entrants</span><strong>{tournament.entrantCount}</strong></article>
      </div>
      <div className="detail-grid">
        <section className="detail-section"><header><p className="eyebrow">Event structure</p><h2>Know the format before you arrive.</h2></header><dl className="definition-list"><div><dt>Late registration</dt><dd>Through level {tournament.lateRegistrationThroughLevel}</dd></div><div><dt>Rebuys</dt><dd>{tournament.unlimitedRebuys ? `Unlimited at $${tournament.rebuyPrice.toLocaleString()} for ${tournament.rebuyStack.toLocaleString()} chips` : 'Not offered'}</dd></div><div><dt>Add-on</dt><dd>{tournament.addOnPrice > 0 ? `$${tournament.addOnPrice.toLocaleString()} for ${tournament.addOnStack.toLocaleString()} chips` : 'Not offered'}</dd></div><div><dt>Live activity</dt><dd>{tournament.totalRebuys} rebuys · {tournament.totalAddOns} add-ons</dd></div><div><dt>Self-unregistration</dt><dd>{tournament.unregisterAllowed ? 'Allowed before the event starts' : 'Contact tournament staff'}</dd></div></dl></section>
        <aside className="rules-panel"><RotateCcw aria-hidden="true" /><p className="eyebrow">Rules</p><h2>House and event rules</h2>{tournament.rules.length ? <ul>{tournament.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p>The host club will provide current rules.</p>}{club ? <ButtonLink href={`/clubs/${clubRouteKey(club)}`} tone="secondary">View host club</ButtonLink> : null}</aside>
      </div>
    </div>
  );
}
