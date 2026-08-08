import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, Interest, InterestStatus, PlayerProfile } from '../../domain/types';
import {
  correctWaitlistInterestTimestamp,
  ensureWaitlistInterest,
  getWaitlistDemandPrompt,
  patchWaitlistInterest,
  removeWaitlistInterest,
  upsertWaitlistInterest
} from './waitlistCommands';

const now = '2026-08-08T20:00:00.000Z';
const game = {
  id: 'game-a',
  name: 'Command Holdem',
  maxSeats: 8,
  minInRoomForLikely: 1,
  minFlexibleForLikely: 2,
  minTotalForViable: 6
};

const profile = (id: string, name: string): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: game.id,
  preferredGameIds: [game.id],
  gamePlayCounts: {},
  mostPlayedGameId: game.id,
  preferredStakes: game.name,
  typicalBuyInMin: 0,
  typicalBuyInMax: 0,
  willingnessToMove: true,
  typicalAvailability: '',
  preferredTags: [],
  usualCompanions: [],
  notes: ''
});

const interest = (id: string, status: InterestStatus = 'Interested'): Interest => ({
  id,
  playerName: id,
  gameId: game.id,
  status,
  timestamp: '2026-08-08T18:00:00.000Z',
  interestedAt: '2026-08-08T17:30:00.000Z',
  notes: `${id} note`
});

const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [game],
  profiles: [],
  interests: [],
  sessions: [],
  playerSessions: [],
  correctionLog: [],
  ...overrides
});

describe('management waitlist commands', () => {
  it.each([
    ['Interested', undefined, undefined, undefined],
    ['Confirmed Coming', now, undefined, undefined],
    ['Arrived', undefined, now, undefined],
    ['Declined', undefined, undefined, now],
    ['No-Show', undefined, undefined, now],
    ['Left Before Seated', undefined, undefined, now],
    ['Removed', undefined, undefined, now]
  ] as const)(
    'creates a canonical %s interest and leaves seating to the seating command',
    (status, confirmedAt, arrivedAt, closedAt) => {
      const source = state();

      const result = upsertWaitlistInterest(source, {
        playerName: '  New Player  ',
        gameId: game.id,
        status,
        notes: '  Command note  '
      }, { createId: () => 'interest-new', nowIso: () => now });

      expect(result.updatedExisting).toBe(false);
      expect(result.interest).toEqual({
        id: 'interest-new',
        profileId: undefined,
        playerName: 'New Player',
        gameId: game.id,
        status,
        notes: 'Command note',
        timestamp: now,
        interestedAt: now,
        confirmedAt,
        arrivedAt,
        seatedAt: undefined,
        closedAt
      });
      expect(result.state.interests).toEqual([result.interest]);
      expect(result.state.playerSessions).toEqual([]);
      expect(source.interests).toEqual([]);
    }
  );

  it('updates the existing active identity, preserves record order, and returns the exact demand prompt', () => {
    const targetProfile = profile('profile-target', 'Target Player');
    const target = {
      ...interest('interest-target'),
      profileId: targetProfile.id,
      playerName: targetProfile.name,
      manualEdits: { notes: '2026-08-08T18:05:00.000Z' }
    };
    const supporting = Array.from({ length: 5 }, (_, index) => interest(`support-${index}`));
    const source = state({ profiles: [targetProfile], interests: [target, ...supporting] });
    const snapshot = structuredClone(source);

    const result = upsertWaitlistInterest(source, {
      playerName: 'target player',
      gameId: game.id,
      status: 'Confirmed Coming',
      notes: '  Updated note  '
    }, { createId: () => 'unused', nowIso: () => now });

    expect(result.updatedExisting).toBe(true);
    expect(result.state.interests.map((item) => item.id)).toEqual([target.id, ...supporting.map((item) => item.id)]);
    expect(result.interest).toEqual({
      ...target,
      profileId: targetProfile.id,
      playerName: 'target player',
      status: 'Confirmed Coming',
      notes: 'Updated note',
      timestamp: now,
      confirmedAt: now,
      closedAt: undefined
    });
    expect(result.demandPrompt).toEqual({
      gameId: game.id,
      activeCount: 6,
      message: '6 players now want Command Holdem. Type "start" to create a new Command Holdem table, "switch" to convert a running table to Command Holdem, or leave blank to skip.',
      defaultChoice: 'start'
    });
    expect(source).toEqual(snapshot);
  });

  it('patches canonical fields and manual edits while suppressing demand for an inactive result', () => {
    const target = {
      ...interest('target'),
      expectedArrivalTime: '7:30 PM',
      manualEdits: { interestedAt: '2026-08-08T18:05:00.000Z' }
    };
    const source = state({ interests: [target, ...Array.from({ length: 5 }, (_, index) => interest(`support-${index}`))] });
    const snapshot = structuredClone(source);

    const result = patchWaitlistInterest(source, target.id, {
      status: 'Removed',
      notes: 'Removed note'
    }, { nowIso: () => now });

    expect(result.changedInterest).toEqual({
      ...target,
      status: 'Removed',
      notes: 'Removed note',
      timestamp: now,
      closedAt: now,
      manualEdits: {
        interestedAt: '2026-08-08T18:05:00.000Z',
        status: now,
        notes: now
      }
    });
    expect(result.demandPrompt).toBeNull();
    expect(result.state.interests[1]).toBe(source.interests[1]);
    expect(source).toEqual(snapshot);
  });

  it('returns no demand prompt below threshold or when the target game already has an open table', () => {
    const fiveActive = state({ interests: Array.from({ length: 5 }, (_, index) => interest(`active-${index}`)) });
    const sixWithOpenTable = state({
      interests: Array.from({ length: 6 }, (_, index) => interest(`active-${index}`)),
      sessions: [{
        id: 'table-open',
        gameId: game.id,
        label: 'Open Table',
        status: 'Running',
        seatsFilled: 0,
        maxSeats: 8,
        tags: [],
        startedAt: now
      }]
    });

    expect(getWaitlistDemandPrompt(fiveActive, game.id)).toBeNull();
    expect(getWaitlistDemandPrompt(sixWithOpenTable, game.id)).toBeNull();
    expect(getWaitlistDemandPrompt(sixWithOpenTable, 'missing-game')).toBeNull();
  });

  it('corrects interest timestamps, mirrors exact session matches, and records audited missing-target no-ops', () => {
    const target = { ...interest('target'), playerName: 'Target Player' };
    const matchingSession = {
      id: 'session-target',
      playerName: target.playerName,
      gameId: target.gameId,
      tableId: 'table-a',
      seatedAt: '2026-08-08T18:30:00.000Z',
      manualEdits: { seatNumber: '2026-08-08T18:35:00.000Z' }
    };
    const otherSession = { ...matchingSession, id: 'session-other', gameId: 'other-game' };
    const source = state({ interests: [target], playerSessions: [matchingSession, otherSession] });

    const corrected = correctWaitlistInterestTimestamp(
      source,
      target.id,
      'closedAt',
      undefined,
      { createId: () => 'correction-1', nowIso: () => now }
    );
    const missing = correctWaitlistInterestTimestamp(
      source,
      'missing-interest',
      'seatedAt',
      now,
      { createId: () => 'correction-2', nowIso: () => now }
    );

    expect(corrected.interests[0]).toEqual({
      ...target,
      closedAt: undefined,
      manualEdits: { closedAt: now }
    });
    expect(corrected.playerSessions[0]).toEqual({
      ...matchingSession,
      leftAt: undefined,
      manualEdits: { seatNumber: '2026-08-08T18:35:00.000Z', leftAt: now }
    });
    expect(corrected.playerSessions[1]).toBe(source.playerSessions[1]);
    expect(corrected.correctionLog[0]).toEqual({
      id: 'correction-1',
      entity: target.playerName,
      field: 'closedAt',
      note: 'Timestamp corrected',
      timestamp: now
    });
    expect(missing.interests[0]).toBe(source.interests[0]);
    expect(missing.playerSessions[0]).toBe(source.playerSessions[0]);
    expect(missing.correctionLog[0]).toMatchObject({
      id: 'correction-2',
      entity: 'missing-interest',
      field: 'seatedAt'
    });
  });

  it('ensures authoritative profile relationships and removes only the requested interest', () => {
    const targetProfile = profile('profile-target', 'Target Player');
    const target = {
      ...interest('target'),
      profileId: targetProfile.id,
      playerName: targetProfile.name,
      notes: ''
    };
    const other = interest('other');
    const source = state({ profiles: [targetProfile], interests: [target, other] });
    const snapshot = structuredClone(source);

    const ensured = ensureWaitlistInterest(
      source,
      targetProfile,
      game.id,
      'Arrived',
      'Checked in',
      now,
      () => 'unused'
    );
    const removed = removeWaitlistInterest(source, target.id);

    expect(ensured).toEqual([
      {
        ...target,
        status: 'Arrived',
        profileId: targetProfile.id,
        timestamp: now,
        arrivedAt: now,
        notes: 'Checked in'
      },
      other
    ]);
    expect(ensured[1]).toBe(source.interests[1]);
    expect(removed.interests).toEqual([other]);
    expect(source).toEqual(snapshot);
  });
});
