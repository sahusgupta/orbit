import { describe, expect, it, vi } from 'vitest';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembershipOption, PlayerMembershipRequest } from '../domain/playerSync';
import { submitPaidMembershipBeforeCheckout } from './usePlayerClubs';

const player: PlayerAccount = {
  id: 'player-1',
  name: 'Alex Rivera',
  email: 'alex@example.test',
  preferredGameIds: ['holdem']
};

const membershipOption: PlayerMembershipOption = {
  id: 'monthly-vip',
  name: 'VIP Month',
  priceLabel: '$79/mo',
  durationDays: 45
};

const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'Club One', minimumAge: 21, membershipOptions: [membershipOption] },
  games: [],
  memberships: [],
  waitlists: [],
  notifications: [],
  social: { activePlayerCount: 0, adminCount: 0, knownPlayersInHouse: 0, waitlistCount: 0 },
  generatedAt: '2026-08-28T00:00:00.000Z'
};

describe('paid membership pre-checkout', () => {
  it('submits the selected online membership plan before checkout and returns the authoritative snapshot', async () => {
    const submit = vi.fn(async (_request: PlayerMembershipRequest) => ({
      ok: true as const,
      snapshot: { ...club, generatedAt: '2026-08-28T00:01:00.000Z' },
      accountKey: 'club-1'
    }));

    await expect(submitPaidMembershipBeforeCheckout(player, club, 'monthly', membershipOption, submit)).resolves.toMatchObject({
      ok: true,
      skipped: false,
      snapshot: { generatedAt: '2026-08-28T00:01:00.000Z' }
    });
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club-1',
      plan: 'monthly',
      planId: 'monthly-vip',
      planName: 'VIP Month',
      planPriceLabel: '$79/mo',
      membershipDurationDays: 45,
      paymentMethod: 'app'
    }));
  });

  it('returns a failed preflight so checkout can abort', async () => {
    const submit = vi.fn(async (_request: PlayerMembershipRequest) => ({ ok: false as const, error: 'Plan is unavailable.' }));
    await expect(submitPaidMembershipBeforeCheckout(player, club, 'monthly', membershipOption, submit))
      .resolves.toEqual({ ok: false, error: 'Plan is unavailable.' });
  });

  it('uses the selected product as the day/monthly plan authority', async () => {
    const submit = vi.fn(async (_request: PlayerMembershipRequest) => ({
      ok: true as const,
      snapshot: club,
      accountKey: 'club-1'
    }));
    const dayOption = { ...membershipOption, id: 'day-special', durationDays: 3 };

    await submitPaidMembershipBeforeCheckout(player, club, 'day', dayOption, submit);

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      plan: 'day',
      planId: 'day-special',
      membershipDurationDays: 3
    }));
  });

  it('skips membership submission for a time package', async () => {
    const submit = vi.fn();
    await expect(submitPaidMembershipBeforeCheckout(player, club, 'time-30', null, submit))
      .resolves.toEqual({ ok: true, skipped: true });
    expect(submit).not.toHaveBeenCalled();
  });
});
