import { ArrowUpRight, CalendarDays, MapPin, UsersRound } from 'lucide-react';
import Link from 'next/link';
import {
  clubRouteKey,
  formatBuyIn,
  formatDistance,
  formatEventDate,
  gameRouteKey,
  getGameAvailabilityLabel,
  getGameStateLabel,
  getTournamentInterestLabel,
  getTournamentInterestState,
  getVenueLabel,
  tournamentRouteKey
} from '@/src/domain/selectors';
import type { GameListing, PlayerClubSnapshot, TournamentListing } from '@/src/domain/types';
import { StatusBadge, type StatusTone } from '@/src/components/ui/status-badge';

function gameTone(state: GameListing['state']): StatusTone {
  if (state === 'running') return 'live';
  if (state === 'forming') return 'forming';
  if (state === 'paused') return 'warning';
  return 'neutral';
}

export function GameCard({ listing, compact = false }: { listing: GameListing; compact?: boolean }) {
  const { club, game, state, distanceMiles, stakes } = listing;
  return (
    <Link className={compact ? 'entity-row entity-row--compact' : 'entity-row'} href={`/games/${gameRouteKey(club, game)}`}>
      <article>
        <div className="entity-row__lead">
          <StatusBadge tone={gameTone(state)}>{getGameStateLabel(state)}</StatusBadge>
          <p className="entity-row__kicker">{club.club.name}</p>
          <h3>{game.name}</h3>
          <p className="entity-row__meta">{stakes} · {getVenueLabel(club)}</p>
        </div>
        <dl className="entity-row__facts">
          <div><dt>Availability</dt><dd>{getGameAvailabilityLabel(game)}</dd></div>
          <div><dt>Location</dt><dd>{formatDistance(distanceMiles)}</dd></div>
        </dl>
        <ArrowUpRight className="entity-row__arrow" aria-hidden="true" size={20} />
      </article>
    </Link>
  );
}

export function ClubCard({ club, distanceMiles }: { club: PlayerClubSnapshot; distanceMiles: number | null }) {
  const running = club.games.filter((game) => game.openTables.some((table) => table.status === 'Running')).length;
  const forming = club.games.filter((game) => game.openTables.some((table) => table.status === 'Forming')).length;
  return (
    <Link className="club-listing" href={`/clubs/${clubRouteKey(club)}`}>
      <article>
        <div className="club-listing__identity">
          <span className="club-monogram" aria-hidden="true">{club.club.name.slice(0, 1).toUpperCase()}</span>
          <div><p className="eyebrow">{getVenueLabel(club)}</p><h3>{club.club.name}</h3><p><MapPin aria-hidden="true" size={15} />{club.club.address || 'Location unavailable'}</p></div>
        </div>
        <dl>
          <div><dt>Running</dt><dd>{running}</dd></div>
          <div><dt>Forming</dt><dd>{forming}</dd></div>
          <div><dt>Distance</dt><dd>{formatDistance(distanceMiles)}</dd></div>
        </dl>
        <ArrowUpRight aria-hidden="true" size={20} />
      </article>
    </Link>
  );
}

export function TournamentCard({ listing, compact = false }: { listing: TournamentListing; compact?: boolean }) {
  const { club, tournament, interest, distanceMiles } = listing;
  const interestOpen = getTournamentInterestState(tournament) === 'open';
  return (
    <Link className={compact ? 'tournament-listing tournament-listing--compact' : 'tournament-listing'} href={`/tournaments/${tournamentRouteKey(club, tournament)}`}>
      <article>
        <div className="date-tile" aria-hidden="true">
          <span>{new Date(tournament.startsAt).toLocaleDateString('en-US', { month: 'short' })}</span>
          <strong>{new Date(tournament.startsAt).getDate()}</strong>
        </div>
        <div className="tournament-listing__main">
          <div className="tournament-listing__badges">
            <StatusBadge tone={interestOpen ? 'success' : 'neutral'}>{getTournamentInterestLabel(tournament)}</StatusBadge>
            {interest?.status === 'interested' ? <StatusBadge tone="live">Interested</StatusBadge> : null}
          </div>
          <p className="entity-row__kicker">{club?.club.name ?? 'Venue unavailable'}</p>
          <h3>{tournament.name}</h3>
          <p>{formatEventDate(tournament.startsAt)} · {formatBuyIn(tournament)}</p>
        </div>
        <dl>
          <div><CalendarDays aria-hidden="true" size={15} /><span>{tournament.levelMinutes == null ? 'Level time unavailable' : `${tournament.levelMinutes} min levels`}</span></div>
          <div><UsersRound aria-hidden="true" size={15} /><span>{tournament.entrantCount == null ? 'Entrants unavailable' : `${tournament.entrantCount} entrants`}</span></div>
          <div><MapPin aria-hidden="true" size={15} /><span>{formatDistance(distanceMiles)}</span></div>
        </dl>
        <ArrowUpRight aria-hidden="true" size={20} />
      </article>
    </Link>
  );
}
