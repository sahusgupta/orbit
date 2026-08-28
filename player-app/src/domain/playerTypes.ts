import type {
  PlayerClubSnapshot,
  PlayerPrivateGameListing,
  PlayerSyncGame,
  PlayerTournament,
  PlayerTournamentRegistration
} from './playerSync';

export type Screen =
  | 'home'
  | 'findGames'
  | 'gameDetails'
  | 'tournaments'
  | 'map'
  | 'clubs'
  | 'clubSignup'
  | 'clubPayment'
  | 'identityVerification'
  | 'settings';
export type OnboardingStep = 0 | 1 | 2 | 3;
export type GameTypeFilter = 'none' | 'all' | 'public' | 'private' | 'card-house' | 'home-game' | 'favorites';
export type DistanceFilter = 'none' | 5 | 10 | 20 | 50;
export type CasinoFilter = 'none' | 'all' | string;
export type TournamentFilter = 'all' | 'open' | 'free' | 'registered';
export type MapVenueFilter = 'all' | 'card-house' | 'casino' | 'club';
export type TimeAccessProduct = 'time-30' | 'time-60' | 'time-120';
export type ClubAccessProduct = 'day' | 'monthly' | TimeAccessProduct;
export type DiscoveryDecision = 'pass' | 'saved';

export type Coordinate = { latitude: number; longitude: number };

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
  distanceMiles: number;
  isJoined: boolean;
  isPreferred: boolean;
};

export type TournamentOpportunity = {
  tournament: PlayerTournament;
  club: PlayerClubSnapshot | undefined;
  registration: PlayerTournamentRegistration | undefined;
  distanceMiles: number;
};

export type PrivateGameDraft = Pick<
  PlayerPrivateGameListing,
  'name' | 'location' | 'startsAt' | 'seats' | 'note'
>;
