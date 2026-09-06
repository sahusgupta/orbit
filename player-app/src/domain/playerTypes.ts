import type {
  PlayerClubSnapshot,
  PlayerCoordinate,
  PlayerSeatRequestAccess,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentInterest
} from './playerSync';

export type Screen =
  | 'home'
  | 'findGames'
  | 'gameDetails'
  | 'tournaments'
  | 'map'
  | 'clubs'
  | 'clubSignup'
  | 'identityVerification'
  | 'settings';
export type OnboardingStep = 0 | 1 | 2 | 3;
export type GameTypeFilter = 'none' | 'all' | 'card-house' | 'favorites';
export type DistanceFilter = 'none' | 5 | 10 | 20 | 50;
export type CasinoFilter = 'none' | 'all' | string;
export type TournamentFilter = 'all' | 'open' | 'free' | 'interested';
export type MapVenueFilter = 'all' | 'card-house' | 'casino' | 'club';
export type DiscoveryDecision = 'pass' | 'saved';

export type Coordinate = PlayerCoordinate;

export type SeatRequestDraft = {
  club: PlayerClubSnapshot;
  game: PlayerSyncGame;
  attendance: 'arrived' | 'confirmed' | 'interested';
  expectedArrivalTime: string;
  availabilityStartTime: string;
  availabilityEndTime: string;
};

export type GameOpportunity = {
  club: PlayerClubSnapshot;
  game: PlayerSyncGame;
  distanceMiles: number | null;
  isJoined: boolean;
  isPreferred: boolean;
  seatRequestAccess: PlayerSeatRequestAccess;
};

export type TournamentOpportunity = {
  tournament: PlayerTournament;
  club: PlayerClubSnapshot | undefined;
  interest: PlayerTournamentInterest | undefined;
  distanceMiles: number | null;
};
