import type { PlayerTournament } from './playerSync';
import type { GameOpportunity } from './playerTypes';

export type MatchVariant = 'nlh' | 'plo' | 'limit-holdem' | 'mixed';
export type MatchReference = { clubId: string; gameId: string; kind: 'cash' | 'tournament' };
export type MatchPreferences = {
  variants: MatchVariant[];
  stakes: { minBigBlind: number; maxBigBlind: number } | null;
  format: 'any' | 'cash' | 'tournament';
  buyIn: { min: number; max: number } | null;
  maxDistanceMiles: number | null;
  favoriteClubIds: string[];
  excludedClubIds: string[];
  requireSeatsNow: boolean;
  willingToWait: boolean;
  maxWaitlist: number | null;
  preferredDays: number[];
  preferredTime: 'any' | 'day' | 'evening';
  exploreNewVenues: boolean;
  strictVariants: boolean;
  strictStakes: boolean;
  strictBuyIn: boolean;
};
export type MatchDecision = {
  ref: MatchReference;
  summary: { venueName: string; gameName: string };
  decision: 'saved' | 'passed';
  mutationId: string;
  decidedAt: string;
};
export type MatchEventKind = 'opened' | 'impression' | 'passed' | 'saved' | 'undo' | 'details' | 'saved-revisit' | 'waitlist-success' | 'empty' | 'load-failed';
export type MatchEvent = {
  eventId: string;
  kind: MatchEventKind;
  at: string;
  ref?: MatchReference;
  saveMutationId?: string;
};
export type MatchState = {
  schemaVersion: 1;
  revision: number;
  preferencesRevision: number;
  preferences: MatchPreferences;
  decisions: MatchDecision[];
  undo: { mutationId: string; ref: MatchReference; previous: MatchDecision | null } | null;
  events: MatchEvent[];
  recentMutationIds: string[];
};
export type MatchOperation =
  | { mutationId: string; type: 'decide'; ref: MatchReference; summary: MatchDecision['summary']; decision: MatchDecision['decision'] }
  | { mutationId: string; type: 'remove'; ref: MatchReference; expectedDecisionMutationId: string }
  | { mutationId: string; type: 'undo'; targetMutationId: string }
  | { mutationId: string; type: 'preferences'; basePreferencesRevision: number; preferences: MatchPreferences }
  | { mutationId: string; type: 'event'; event: Omit<MatchEvent, 'at' | 'eventId'> };
export type MatchJournal = { uid: string; confirmed: MatchState | null; pending: MatchOperation[] };
export type MatchPersistencePort = {
  loadJournal(uid: string): Promise<unknown>;
  saveJournal(uid: string, journal: MatchJournal): Promise<void>;
  fetchState(uid: string): Promise<MatchState>;
  mutate(uid: string, operation: MatchOperation): Promise<MatchState>;
  subscribe(uid: string, onState: (state: MatchState) => void, onError: (error: Error) => void): () => void;
};
export type MatchCandidate = {
  ref: MatchReference;
  summary: MatchDecision['summary'];
  opportunity: GameOpportunity | null;
  tournament: PlayerTournament | null;
  variant: MatchVariant | null;
  bigBlind: number | null;
  buyIn: number | null;
  distanceMiles: number | null;
  status: 'live' | 'forming' | 'paused' | 'scheduled' | 'inactive';
  availableSeats: number | null;
  waitlistCount: number | null;
  publishedAt: string | null;
  activeRequest?: boolean;
};
export type RankedMatchCandidate = MatchCandidate & {
  score: number;
  components: { stakes: number; proximity: number; variant: number; availability: number; venue: number };
  reasons: string[];
};
export type SavedMatchGame = { record: MatchDecision; candidate: MatchCandidate | null; unavailableReason: string | null };

export const defaultMatchPreferences: MatchPreferences = {
  variants: [], stakes: null, format: 'any', buyIn: null, maxDistanceMiles: null,
  favoriteClubIds: [], excludedClubIds: [], requireSeatsNow: false, willingToWait: true,
  maxWaitlist: null, preferredDays: [], preferredTime: 'any', exploreNewVenues: false,
  strictVariants: false, strictStakes: false, strictBuyIn: false
};
export function matchReferenceKey(ref: MatchReference) {
  return JSON.stringify([ref.clubId, ref.kind, ref.gameId]);
}
