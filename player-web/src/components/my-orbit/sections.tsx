'use client';

import { CalendarCheck, CircleDot, Clock3, MapPin, UserCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { usePlayerData } from '@/src/data/player-data-context';
import {
  clubRouteKey,
  formatEventDate,
  gameRouteKey,
  getActivePlayerRequests,
  getMembershipState,
  getPlayerMembership,
  tournamentRouteKey
} from '@/src/domain/selectors';
import { getPublishedMembershipPlanLabel, getWaitlistAheadText, isTournamentInterestFor } from '@orbit/player-domain/playerSync';
import { ButtonLink } from '@/src/components/ui/button';
import { EmptyState, ErrorState, SectionHeading, SkeletonList } from '@/src/components/ui/state-panels';
import { StatusBadge } from '@/src/components/ui/status-badge';

function PlayerDataBoundary({ children }: { children: ReactNode }) {
  const data = usePlayerData();
  if (data.status === 'idle' || data.status === 'loading') return <SkeletonList rows={4} />;
  if (data.status === 'error') return <ErrorState title="My Orbit could not refresh" message={data.error} onRetry={() => void data.refresh()} />;
  return children;
}

export function MyOrbitOverview() {
  return <PlayerDataBoundary><OverviewContent /></PlayerDataBoundary>;
}

function OverviewContent() {
  const { player } = useAuth();
  const data = usePlayerData();
  const memberships = data.clubs.map((club) => ({ club, state: getMembershipState(club, player), membership: getPlayerMembership(club, player) })).filter((item) => item.state !== 'none' && item.state !== 'expired');
  const requests = getActivePlayerRequests(data.clubs, player);
  const interests = data.interests.filter((interest) => interest.status === 'interested').map((interest) => ({ interest, tournament: data.tournaments.find((event) => isTournamentInterestFor(interest, event)), club: data.clubs.find((candidate) => candidate.club.id === interest.clubId) })).filter((item) => item.tournament);
  const hasActivity = memberships.length || requests.length || interests.length;
  return (
    <div className="stack-2xl">
      <section><SectionHeading eyebrow="Right now" title={`Welcome back${player?.name ? `, ${player.name.split(' ')[0]}` : ''}.`} />{hasActivity ? <div className="commitment-grid">
        {requests.slice(0, 2).map(({ club, game, entry }) => <Link className="commitment-card commitment-card--live" key={entry.id} href={game ? `/games/${gameRouteKey(club, game)}` : `/clubs/${clubRouteKey(club)}`}><CircleDot aria-hidden="true" /><StatusBadge tone="live">{entry.status}</StatusBadge><h3>{game?.name ?? 'Game request'}</h3><p>{club.club.name}</p><strong>{getWaitlistAheadText(entry)}</strong></Link>)}
        {interests.slice(0, 2).map(({ interest, tournament, club }) => tournament ? <Link className="commitment-card" key={JSON.stringify([interest.clubId, interest.id])} href={`/tournaments/${tournamentRouteKey(club, tournament)}`}><CalendarCheck aria-hidden="true" /><StatusBadge tone="success">Interested</StatusBadge><h3>{tournament.name}</h3><p>{club?.club.name ?? 'Venue unavailable'}</p><strong>{formatEventDate(tournament.startsAt)}</strong></Link> : null)}
        {memberships.slice(0, 2).map(({ club, state }) => <Link className="commitment-card" key={club.club.id} href={`/clubs/${clubRouteKey(club)}`}><UserCheck aria-hidden="true" /><StatusBadge tone={state === 'active' ? 'success' : 'warning'}>{state === 'active' ? 'Active member' : 'Under review'}</StatusBadge><h3>{club.club.name}</h3><p>{club.club.address || 'Location unavailable'}</p><strong>{state === 'active' ? 'Ready for game requests' : 'Awaiting club action'}</strong></Link>)}
      </div> : <EmptyState title="Your next move starts with discovery" message="Join a club, request a game, or express interest in a tournament. It will appear here immediately." action={<ButtonLink href="/games">Find a game</ButtonLink>} />}</section>
      <section className="next-actions"><SectionHeading eyebrow="Keep moving" title="Fast paths" /><div><ButtonLink href="/games" tone="secondary">Browse games</ButtonLink><ButtonLink href="/tournaments" tone="secondary">Upcoming tournaments</ButtonLink><ButtonLink href="/clubs" tone="secondary">Find clubs</ButtonLink></div></section>
    </div>
  );
}

export function MyClubs() {
  return <PlayerDataBoundary><MyClubsContent /></PlayerDataBoundary>;
}

function MyClubsContent() {
  const { player } = useAuth();
  const data = usePlayerData();
  const clubs = data.clubs.map((club) => ({ club, state: getMembershipState(club, player), membership: getPlayerMembership(club, player) })).filter((item) => item.state !== 'none');
  return <section className="my-section"><SectionHeading eyebrow="Memberships" title="My Clubs" />{clubs.length ? <div className="my-list">{clubs.map(({ club, state, membership }) => <Link key={club.club.id} href={`/clubs/${clubRouteKey(club)}`}><span className="club-monogram" aria-hidden="true">{club.club.name.slice(0, 1)}</span><div><StatusBadge tone={state === 'active' ? 'success' : state === 'requested' ? 'warning' : 'neutral'}>{state === 'active' ? 'Active' : state === 'requested' ? 'Under review' : 'Expired'}</StatusBadge><h2>{club.club.name}</h2><p><MapPin aria-hidden="true" />{club.club.address || 'Location unavailable'}</p></div><strong>{getPublishedMembershipPlanLabel(membership ?? {})}</strong></Link>)}</div> : <EmptyState title="No memberships yet" message="Public club discovery is open. Request membership only when you find the right room." action={<ButtonLink href="/clubs">Browse clubs</ButtonLink>} />}</section>;
}

export function MyGames() {
  return <PlayerDataBoundary><MyGamesContent /></PlayerDataBoundary>;
}

function MyGamesContent() {
  const { player } = useAuth();
  const data = usePlayerData();
  const requests = getActivePlayerRequests(data.clubs, player);
  return <section className="my-section"><SectionHeading eyebrow="Active commitments" title="My Games" />{requests.length ? <div className="my-list">{requests.map(({ club, game, entry }) => <Link key={entry.id} href={game ? `/games/${gameRouteKey(club, game)}` : `/clubs/${clubRouteKey(club)}`}><Clock3 aria-hidden="true" /><div><StatusBadge tone="live">{entry.status}</StatusBadge><h2>{game?.name ?? 'Game request'}</h2><p>{club.club.name}</p></div><strong>{getWaitlistAheadText(entry)}</strong></Link>)}</div> : <EmptyState title="No active game commitments" message="When you join a waitlist or express interest in a forming game, it will stay visible here." action={<ButtonLink href="/games">Find a game</ButtonLink>} />}</section>;
}

export function MyTournaments() {
  return <PlayerDataBoundary><MyTournamentsContent /></PlayerDataBoundary>;
}

function MyTournamentsContent() {
  const data = usePlayerData();
  const entries = data.interests.filter((interest) => interest.status === 'interested').map((interest) => ({ interest, tournament: data.tournaments.find((event) => isTournamentInterestFor(interest, event)), club: data.clubs.find((candidate) => candidate.club.id === interest.clubId) })).filter((item) => item.tournament);
  return <section className="my-section"><SectionHeading eyebrow="Tournament interest" title="My Tournaments" />{entries.length ? <div className="my-list">{entries.map(({ interest, tournament, club }) => tournament ? <Link key={JSON.stringify([interest.clubId, interest.id])} href={`/tournaments/${tournamentRouteKey(club, tournament)}`}><CalendarCheck aria-hidden="true" /><div><StatusBadge tone="success">Interested</StatusBadge><h2>{tournament.name}</h2><p>{club?.club.name ?? 'Venue unavailable'}</p></div><strong>{formatEventDate(tournament.startsAt)}</strong></Link> : null)}</div> : <EmptyState title="No tournament interests" message="Browse event structure and timing, then express nonbinding interest when you find the right one." action={<ButtonLink href="/tournaments">Browse tournaments</ButtonLink>} />}</section>;
}
