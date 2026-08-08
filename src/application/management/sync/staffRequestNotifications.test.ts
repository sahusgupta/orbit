import { describe, expect, it } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState, Interest, PlayerProfile } from '../../../domain/types';
import {
  getIncomingStaffRequestNotice,
  loadStaffRequestNotifications,
  prependStaffRequestNotification,
  saveStaffRequestNotifications,
  staffNotificationsStorageKey,
  type StaffRequestNotice
} from './staffRequestNotifications';

const profile = (id: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id,
  name: id,
  phone: '',
  birthday: '',
  membershipStartDate: '',
  membershipExpirationDate: '',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: 'notice-game',
  preferredGameIds: ['notice-game'],
  gamePlayCounts: {},
  mostPlayedGameId: 'notice-game',
  preferredStakes: '',
  typicalBuyInMin: 100,
  typicalBuyInMax: 300,
  willingnessToMove: true,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: '',
  ...overrides
});

const interest = (id: string, timestamp: string): Interest => ({
  id,
  profileId: id,
  playerName: id,
  gameId: 'notice-game',
  status: 'Interested',
  timestamp,
  interestedAt: timestamp,
  notes: ''
});

const state = (profiles: PlayerProfile[] = [], interests: Interest[] = []): AppState => ({
  ...structuredClone(seedState),
  games: [{ id: 'notice-game', name: 'Notice Game', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }],
  profiles,
  interests
});

const clock = {
  nowIso: () => '2026-08-08T22:00:00.000Z',
  nowMs: () => 1_786_226_400_000
};

describe('staff request notification policy', () => {
  it('selects the newest new membership before a simultaneous seat request', () => {
    const previous = state();
    const next = state([
      profile('older', { membershipStatus: 'Requested', membershipRequestedAt: '2026-08-08T20:00:00.000Z' }),
      profile('newer', { membershipStatus: 'Requested', membershipRequestedAt: '2026-08-08T21:00:00.000Z' })
    ], [interest('seat', '2026-08-08T21:30:00.000Z')]);

    expect(getIncomingStaffRequestNotice(previous, next, clock)).toEqual({
      id: 'membership-newer-2026-08-08T21:00:00.000Z',
      kind: 'membership',
      title: 'New membership request',
      body: 'newer applied from the player app.',
      createdAt: clock.nowIso(),
      read: false
    });
  });

  it('selects the newest new seat and uses the current game label', () => {
    const next = state([], [
      interest('older-seat', '2026-08-08T20:00:00.000Z'),
      interest('newer-seat', '2026-08-08T21:00:00.000Z')
    ]);

    expect(getIncomingStaffRequestNotice(state(), next, clock)).toMatchObject({
      id: 'seat-newer-seat',
      kind: 'seat',
      body: 'newer-seat requested a seat in Notice Game.'
    });
    expect(getIncomingStaffRequestNotice(next, next, clock)).toBeNull();
  });

  it('deduplicates newest-first, caps at 100, and round-trips browser storage', () => {
    const existing = Array.from({ length: 100 }, (_, index): StaffRequestNotice => ({
      id: `notice-${index}`,
      kind: 'seat',
      title: `Notice ${index}`,
      body: '',
      createdAt: clock.nowIso(),
      read: false
    }));
    const replacement = { ...existing[50], title: 'Replacement' };
    const next = prependStaffRequestNotification(existing, replacement);
    expect(next).toHaveLength(100);
    expect(next[0]).toEqual(replacement);
    expect(next.filter((notice) => notice.id === replacement.id)).toHaveLength(1);

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    saveStaffRequestNotifications(next, storage);
    expect(values.has(staffNotificationsStorageKey)).toBe(true);
    expect(loadStaffRequestNotifications(storage)).toEqual(next);
    values.set(staffNotificationsStorageKey, '{invalid');
    expect(loadStaffRequestNotifications(storage)).toEqual([]);
  });
});
