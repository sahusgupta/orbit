import { describe, expect, it } from 'vitest';
import { createMembershipQrValue, parseMembershipQrValue, validateMembershipQrCheckIn } from './membershipQr';

describe('membership QR credentials', () => {
  it('round-trips a club and player identity', () => {
    const value = createMembershipQrValue('club:one', 'player/123');
    expect(parseMembershipQrValue(value)).toEqual({
      version: 1,
      clubId: 'club:one',
      playerId: 'player/123'
    });
  });

  it('rejects unrelated and malformed QR values', () => {
    expect(parseMembershipQrValue('https://example.com')).toBeNull();
    expect(parseMembershipQrValue('orbit-membership:v1:club-only')).toBeNull();
    expect(parseMembershipQrValue('orbit-membership:v1::player')).toBeNull();
    expect(parseMembershipQrValue('orbit-membership:v2:club:player')).toBeNull();
  });

  it('only accepts active, unexpired members from the current club', () => {
    const value = createMembershipQrValue('club-one', 'player-one');
    const activeProfile = {
      id: 'player-one',
      name: 'Active Player',
      membershipStatus: 'Active' as const,
      membershipExpiresAt: '2027-01-01T00:00:00.000Z'
    };
    expect(validateMembershipQrCheckIn(value, 'club-one', [activeProfile], Date.parse('2026-07-27T00:00:00.000Z'))).toMatchObject({
      ok: true,
      profile: activeProfile
    });
    expect(validateMembershipQrCheckIn(value, 'club-two', [activeProfile])).toEqual({ ok: false, code: 'wrong-club' });
    expect(validateMembershipQrCheckIn(value, 'club-one', [{ ...activeProfile, membershipStatus: 'Approved' }])).toMatchObject({
      ok: false,
      code: 'approved-not-active'
    });
    expect(validateMembershipQrCheckIn(value, 'club-one', [activeProfile], Date.parse('2027-01-02T00:00:00.000Z'))).toMatchObject({
      ok: false,
      code: 'inactive'
    });
  });
});
