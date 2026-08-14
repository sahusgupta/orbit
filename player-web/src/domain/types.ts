import type {
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration,
  PlayerWaitlistEntry
} from '@orbit/player-domain/playerSync';
import type { Coordinate } from '@orbit/player-domain/playerTypes';

export type {
  Coordinate,
  PlayerAccount,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration,
  PlayerWaitlistEntry
};

export type DiscoveryPage = {
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
};

export type DiscoveryPayload = {
  clubs: PlayerClubSnapshot[];
  tournaments: PlayerTournament[];
  registrations: PlayerTournamentRegistration[];
  page: DiscoveryPage;
};

export type DataResult<T> =
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string };

export type GameState = 'running' | 'forming' | 'paused' | 'scheduled';

export type GameListing = {
  club: PlayerClubSnapshot;
  game: PlayerSyncGame;
  state: GameState;
  distanceMiles: number;
  stakes: string;
};

export type GameFilters = {
  query: string;
  gameType: string;
  stakes: string;
  venue: string;
  status: string;
  distance: string;
};

export type ClubFilters = {
  query: string;
  distance: string;
  activity: string;
};

export type TournamentFilters = {
  query: string;
  club: string;
  distance: string;
  registration: string;
};

export type TournamentListing = {
  club: PlayerClubSnapshot | undefined;
  tournament: PlayerTournament;
  registration: PlayerTournamentRegistration | undefined;
  distanceMiles: number;
};

export type SeatRequestInput = {
  attendance: 'arrived' | 'confirmed' | 'interested';
  expectedArrivalTime?: string;
  availabilityStartTime?: string;
  availabilityEndTime?: string;
};

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };
