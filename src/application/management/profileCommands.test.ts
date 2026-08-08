import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState, PlayerProfile } from '../../domain/types';
import {
  buildPlayerProfile,
  checkProfileIntoClub,
  createActiveMemberProfile,
  deleteProfile,
  mergeDuplicateProfiles,
  removeProfileFromClub,
  saveEditedProfile
} from './profileCommands';

const now = '2026-08-08T20:00:00.000Z';
const games = [
  { id: 'game-holdem', name: 'Holdem', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 },
  { id: 'game-omaha', name: 'Omaha', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }
];
const profile = (id: string, name: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2027-01-01',
  totalTimePlayedHours: 1,
  lastSessionTimePlayedHours: 1,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: games[0].id,
  preferredGameIds: [games[0].id],
  gamePlayCounts: {},
  mostPlayedGameId: games[0].id,
  preferredStakes: '1/2',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: false,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: '',
  ...overrides
});
const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games,
  profiles: [],
  interests: [],
  playerSessions: [],
  buyIns: [],
  revenueTransactions: [],
  playerLedger: [],
  ...overrides
});
const dependencies = () => {
  let nextId = 0;
  return {
    createProfileId: () => 'profile-created',
    createId: () => `created-${++nextId}`,
    nowDate: () => new Date(now),
    nowIso: () => now,
    todayDate: () => '2026-08-08',
    nextYearDate: () => '2027-08-08'
  };
};
const newProfileInput = {
  name: '  New Member  ',
  phone: ' 555-0100 ',
  birthday: '1990-01-02',
  membershipPlan: 'monthly' as const,
  membershipAmount: 42.75,
  totalTimePlayedHours: 3,
  lastSessionTimePlayedHours: 2,
  commonlyPlaysWithProfileIds: ['friend'],
  preferredGameId: games[0].id,
  preferredGameIds: [games[0].id],
  preferredStakes: ' ',
  typicalBuyInMin: 200,
  typicalBuyInMax: 500,
  willingnessToMove: true,
  typicalAvailability: ' Friday ',
  preferredTags: ['Action' as const],
  usualCompanions: ' One, Two ,, ',
  notes: ' Note '
};

describe('management profile commands', () => {
  it('builds quick-created profiles with the established defaults and explicit patch precedence', () => {
    const built = buildPlayerProfile(state(), '  Quick Player ', games[1].id, {
      id: 'provided-id',
      preferredGameIds: [],
      typicalBuyInMin: 0,
      willingnessToMove: false
    }, dependencies());

    expect(built).toEqual({
      id: 'provided-id',
      name: 'Quick Player',
      phone: '',
      birthday: '',
      membershipStartDate: '2026-08-08',
      membershipExpirationDate: '2027-08-08',
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: games[1].id,
      preferredGameIds: [games[1].id],
      gamePlayCounts: {},
      mostPlayedGameId: games[1].id,
      preferredStakes: games[1].name,
      typicalBuyInMin: 0,
      typicalBuyInMax: 500,
      willingnessToMove: false,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    });
  });

  it('creates an active member and the exact optional manual revenue shape', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const result = createActiveMemberProfile(source, newProfileInput, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      id: 'profile-created',
      name: 'New Member',
      phone: '555-0100',
      membershipStartDate: '2026-08-08',
      membershipExpirationDate: '2026-09-07',
      membershipExpiresAt: '2026-09-07T20:00:00.000Z',
      membershipStatus: 'Active',
      membershipPaymentMethod: 'core',
      membershipPriceLabel: '$42.75',
      preferredStakes: 'Holdem',
      typicalAvailability: 'Friday',
      usualCompanions: ['One', 'Two'],
      notes: 'Note'
    });
    expect(result.state.revenueTransactions).toEqual([{
      id: 'created-1',
      type: 'membership',
      amountCents: 4275,
      occurredAt: now,
      paymentStatus: 'paid',
      source: 'manual',
      playerName: 'New Member',
      membershipPlan: 'monthly'
    }]);
    expect(result.state.revenueTransactions[0]).not.toHaveProperty('playerId');
    expect(source).toEqual(snapshot);
  });

  it('returns explicit name validation failures without fabricating profiles or revenue', () => {
    const existing = profile('profile-existing', 'Existing');
    const source = state({ profiles: [existing] });
    const missing = createActiveMemberProfile(source, { ...newProfileInput, name: ' ' }, dependencies());
    const duplicate = createActiveMemberProfile(source, { ...newProfileInput, name: ' existing ' }, dependencies());

    expect(missing).toMatchObject({ ok: false, code: 'missing-name', profileName: '' });
    expect(duplicate).toMatchObject({ ok: false, code: 'duplicate-name', profileName: 'existing' });
    expect(source.revenueTransactions).toEqual([]);
  });

  it('saves normalized edits and propagates authoritative names to all named references', () => {
    const original = profile('profile-edit', 'Old Name');
    const other = profile('profile-other', 'Other');
    const source = state({
      profiles: [original, other],
      interests: [{ id: 'interest', profileId: original.id, playerName: original.name, gameId: games[0].id, status: 'Arrived', timestamp: now, interestedAt: now, notes: '' }],
      playerSessions: [{ id: 'session', profileId: original.id, playerName: original.name, gameId: games[0].id, tableId: 'table', seatedAt: now }],
      buyIns: [{ id: 'buy-in', profileId: original.id, playerName: original.name, tableId: 'table', gameId: games[0].id, amount: 200, timestamp: now }],
      playerLedger: [{ id: 'ledger', profileId: original.id, playerName: original.name, type: 'Check-In', timestamp: now }]
    });
    const result = saveEditedProfile(source, {
      ...original,
      name: '  Edited Name ',
      phone: ' 555 ',
      preferredGameId: '',
      preferredGameIds: [],
      preferredStakes: ' 2/5 ',
      typicalAvailability: ' Nights ',
      notes: ' Note '
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      name: 'Edited Name',
      phone: '555',
      preferredGameId: games[0].id,
      preferredGameIds: [games[0].id],
      preferredStakes: '2/5',
      typicalAvailability: 'Nights',
      notes: 'Note'
    });
    expect(result.state.interests[0].playerName).toBe('Edited Name');
    expect(result.state.playerSessions[0].playerName).toBe('Edited Name');
    expect(result.state.buyIns[0].playerName).toBe('Edited Name');
    expect(result.state.playerLedger[0].playerName).toBe('Edited Name');
    expect(saveEditedProfile(source, { ...original, name: ' other ' })).toMatchObject({ ok: false, code: 'duplicate-name' });
  });

  it('deletes only the selected profile and clears only its authoritative interest IDs', () => {
    const target = profile('profile-target', 'Same Name');
    const other = profile('profile-other', 'Same Name');
    const source = state({
      profiles: [target, other],
      interests: [
        { id: 'target', profileId: target.id, playerName: target.name, gameId: games[0].id, status: 'Arrived', timestamp: now, interestedAt: now, notes: '' },
        { id: 'other', profileId: other.id, playerName: other.name, gameId: games[0].id, status: 'Arrived', timestamp: now, interestedAt: now, notes: '' },
        { id: 'unlinked', playerName: target.name, gameId: games[0].id, status: 'Arrived', timestamp: now, interestedAt: now, notes: '' }
      ]
    });

    const result = deleteProfile(source, target.id);

    expect(result.profiles).toEqual([other]);
    expect(result.interests).toEqual([
      { ...source.interests[0], profileId: undefined },
      source.interests[1],
      source.interests[2]
    ]);
  });

  it('merges selected duplicate identities and retargets only their references', () => {
    const primary = profile('primary', 'Duplicate', {
      totalTimePlayedHours: 2,
      gamePlayCounts: { [games[0].id]: 1 },
      commonlyPlaysWithProfileIds: ['duplicate', 'friend'],
      notes: 'Primary'
    });
    const duplicate = profile('duplicate', 'Duplicate', {
      totalTimePlayedHours: 3,
      preferredGameId: games[1].id,
      preferredGameIds: [games[1].id],
      gamePlayCounts: { [games[1].id]: 4 },
      notes: 'Duplicate'
    });
    const unrelated = profile('unrelated', 'Unrelated');
    const source = state({
      profiles: [primary, unrelated, duplicate],
      interests: [{ id: 'interest', profileId: duplicate.id, playerName: duplicate.name, gameId: games[1].id, status: 'Arrived', timestamp: now, interestedAt: now, notes: '' }],
      playerSessions: [{ id: 'session', profileId: duplicate.id, playerName: duplicate.name, gameId: games[1].id, tableId: 'table', seatedAt: now }]
    });

    const result = mergeDuplicateProfiles(source, [primary, duplicate]);

    expect(result.profiles.map((candidate) => candidate.id)).toEqual([primary.id, unrelated.id]);
    expect(result.profiles[0]).toMatchObject({
      totalTimePlayedHours: 5,
      gamePlayCounts: { [games[0].id]: 1, [games[1].id]: 4 },
      mostPlayedGameId: games[1].id,
      commonlyPlaysWithProfileIds: ['friend'],
      notes: 'Primary | Duplicate'
    });
    expect(result.interests[0].profileId).toBe(primary.id);
    expect(result.playerSessions[0].profileId).toBe(primary.id);
    expect(result.profiles[1]).toBe(source.profiles[1]);
  });

  it('checks profiles in and removes only canonical arrived relationships', () => {
    const target = profile('profile-target', 'Target', { preferredGameIds: [games[1].id] });
    const source = state({ profiles: [target] });
    const checkedIn = checkProfileIntoClub(source, target, dependencies());

    expect(checkedIn.preferredGameId).toBe(games[1].id);
    expect(checkedIn.state.interests[0]).toMatchObject({
      id: 'created-1',
      profileId: target.id,
      playerName: target.name,
      gameId: games[1].id,
      status: 'Arrived',
      timestamp: now,
      arrivedAt: now
    });
    expect(checkedIn.state.playerLedger[0]).toMatchObject({
      id: 'created-2',
      type: 'Check-In',
      profileId: target.id,
      gameId: games[1].id,
      timestamp: now
    });
    const withClosed = {
      ...checkedIn.state,
      interests: [
        checkedIn.state.interests[0],
        { ...checkedIn.state.interests[0], id: 'closed', status: 'Seated' as const }
      ]
    };
    expect(removeProfileFromClub(withClosed, target).interests).toEqual([withClosed.interests[1]]);
  });
});
