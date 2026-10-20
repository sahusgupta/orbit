import type { MatchOperation, MatchPreferences, MatchReference, MatchState } from '../../../../player-app/src/domain/orbitMatchTypes';
export class MatchStateError extends Error { code: string; status: number; constructor(code: string, message: string, status?: number); }
export function createMatchState(preferences?: MatchPreferences): MatchState;
export function decodeMatchState(value: unknown): MatchState | null;
export function decodeMatchOperation(value: unknown): MatchOperation | null;
export function applyMatchOperation(state: MatchState, operation: MatchOperation, nowMs?: number): MatchState;
export function pruneMatchState(state: MatchState, nowMs: number): MatchState;
export function matchReferenceKey(ref: MatchReference): string;
export const matchEventRetentionMs: number;
export const maxMatchEvents: number;
export const maxRecentMatchPasses: number;
export const maxRecentMatchMutationIds: number;
