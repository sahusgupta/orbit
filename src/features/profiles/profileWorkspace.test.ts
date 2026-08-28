/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { PlayerProfile } from '../../domain/types';
import { getProfileWorkspaceGroups, isArchivedOrExpiredProfile, type PlayerSection } from './profileWorkspace';

const profile = (id: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile => ({
  id,
  name: id,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-01-01',
  membershipExpirationDate: '2099-01-01',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: 'game',
  preferredGameIds: ['game'],
  gamePlayCounts: {},
  mostPlayedGameId: 'game',
  preferredStakes: '',
  typicalBuyInMin: 0,
  typicalBuyInMax: 0,
  willingnessToMove: false,
  typicalAvailability: '',
  usualCompanions: [],
  preferredTags: [],
  notes: '',
  ...overrides
});

describe('profile workspace archive grouping', () => {
  it('keeps current, requested, approved, expired, and explicitly archived profiles in distinct queues', () => {
    const current = profile('current');
    const active = profile('active', { membershipStatus: 'Active', membershipExpiresAt: '2099-01-01T00:00:00.000Z' });
    const requested = profile('requested', { membershipStatus: 'Requested' });
    const approved = profile('approved', { membershipStatus: 'Approved' });
    const expiredStatus = profile('expired-status', { membershipStatus: 'Expired' });
    const expiredWindow = profile('expired-window', { membershipStatus: 'Active', membershipExpiresAt: '2000-01-01T00:00:00.000Z' });
    const archived = profile('archived', {
      archivedAt: '2026-08-08T20:00:00.000Z'
    } as Partial<PlayerProfile> & { archivedAt: string });

    const groups = getProfileWorkspaceGroups([current, active, requested, approved, expiredStatus, expiredWindow, archived]);

    expect(groups.membershipDirectoryProfiles.map(({ id }) => id)).toEqual(['current', 'active']);
    expect(groups.activeMemberProfiles.map(({ id }) => id)).toEqual(['active']);
    expect(groups.pendingMembershipProfiles.map(({ id }) => id)).toEqual(['requested']);
    expect(groups.approvedMembershipProfiles.map(({ id }) => id)).toEqual(['approved']);
    expect(groups.archivedProfiles.map(({ id }) => id)).toEqual(['expired-status', 'expired-window', 'archived']);
    expect(isArchivedOrExpiredProfile(current)).toBe(false);
  });

  it('includes archive in the player-section contract', () => {
    const section: PlayerSection = 'archive';
    expect(section).toBe('archive');
  });
});
