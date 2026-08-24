import { describe, expect, it } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState } from '../../../domain/types';
import { mergeIncomingPlayerOperations } from './useManagementPlayerUpdateSync';

describe('management incoming player operation reconciliation', () => {
  it('imports authoritative seating and assistance lists while preserving unrelated local state', () => {
    const latest: AppState = {
      ...structuredClone(seedState),
      games: [{ id: 'game', name: '1/2 NLH', maxSeats: 8, minInRoomForLikely: 4, minFlexibleForLikely: 2, minTotalForViable: 6 }],
      sessions: [{ id: 'table', gameId: 'game', label: 'Table 1', status: 'Forming', seatsFilled: 0, maxSeats: 8, tags: [], startedAt: '' }],
      feedback: [{ id: 'local-feedback', role: 'Staff', text: 'Preserve me', createdAt: '2026-08-24T11:00:00.000Z' }]
    };
    const remote: AppState = {
      ...structuredClone(latest),
      profiles: [{
        id: 'profile', name: 'Player', phone: '', birthday: '', membershipStartDate: '', membershipExpirationDate: '',
        totalTimePlayedHours: 0, lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'game',
        preferredGameIds: ['game'], gamePlayCounts: { game: 1 }, mostPlayedGameId: 'game', preferredStakes: '',
        typicalBuyInMin: 0, typicalBuyInMax: 0, willingnessToMove: false, typicalAvailability: '', usualCompanions: [],
        preferredTags: [], notes: ''
      }],
      sessions: [{ ...latest.sessions[0], status: 'Running', seatsFilled: 1, startedAt: '2026-08-24T12:00:00.000Z' }],
      playerSessions: [{ id: 'player-session', profileId: 'profile', playerName: 'Player', gameId: 'game', tableId: 'table', seatNumber: 1, seatedAt: '2026-08-24T12:00:00.000Z' }],
      interests: [{ id: 'interest', profileId: 'profile', playerName: 'Player', gameId: 'game', status: 'Seated', timestamp: '2026-08-24T12:00:00.000Z', interestedAt: '2026-08-24T12:00:00.000Z', seatedAt: '2026-08-24T12:00:00.000Z', notes: '' }],
      playerLedger: [{ id: 'ledger', type: 'Check-In', profileId: 'profile', playerName: 'Player', tableId: 'table', gameId: 'game', timestamp: '2026-08-24T12:00:00.000Z' }],
      staffRequests: [{ id: 'help', type: 'self-check-in-assistance', playerName: 'New Player', reason: 'not-found', status: 'pending', createdAt: '2026-08-24T12:01:00.000Z' }],
      selfCheckIn: { capabilityGeneration: 'generation-one', generatedAt: '2026-08-24T11:59:00.000Z' }
    };

    const merged = mergeIncomingPlayerOperations(latest, remote);

    expect(merged.profiles).toEqual(remote.profiles);
    expect(merged.sessions).toEqual(remote.sessions);
    expect(merged.playerSessions).toEqual(remote.playerSessions);
    expect(merged.interests).toEqual(remote.interests);
    expect(merged.playerLedger).toEqual(remote.playerLedger);
    expect(merged.staffRequests).toEqual(remote.staffRequests);
    expect(merged.selfCheckIn).toEqual(remote.selfCheckIn);
    expect(merged.feedback).toBe(latest.feedback);
  });

  it('is stable on a repeated poll and keeps authoritative newest-first ledger order', () => {
    const latest = structuredClone(seedState);
    const remote = {
      ...structuredClone(seedState),
      playerLedger: [
        { id: 'new', type: 'Check-In' as const, playerName: 'New', timestamp: '2026-08-24T12:00:00.000Z' },
        { id: 'old', type: 'Check-In' as const, playerName: 'Old', timestamp: '2026-08-24T11:00:00.000Z' }
      ]
    };
    const first = mergeIncomingPlayerOperations(latest, remote);
    const second = mergeIncomingPlayerOperations(first, remote);
    expect(second.playerLedger.map((entry) => entry.id)).toEqual(['new', 'old']);
    expect(second).toEqual(first);
  });
});
