import { describe, expect, it } from 'vitest';
import type { PlayerAccount, PlayerMembershipOption } from '../domain/playerSync';
import { buildJoinRequest } from './playerRequests';

const player: PlayerAccount = { id: 'opaque-player-id', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] };

describe('membership request construction', () => {
  it.each([
    { id: 'seven-day', name: 'Seven-day summer access', priceLabel: '$25', durationDays: 7 },
    { id: 'annual', name: 'Venue annual access', priceLabel: '$0', durationDays: 365 },
    { id: 'single-day', name: 'Venue single-day access', priceLabel: '$10', durationDays: 1 }
  ] as PlayerMembershipOption[])('preserves the selected published option without inventing payment semantics', (option) => {
    const request = buildJoinRequest(player, 'club-opaque', option);
    expect(request).toMatchObject({
      clubId: 'club-opaque', paymentMethod: 'in-person', planId: option.id,
      planName: option.name, planPriceLabel: option.priceLabel, membershipDurationDays: option.durationDays
    });
    expect(request).not.toHaveProperty('plan');
    expect(request.id).not.toMatch(/alex|example|club-opaque/i);
  });

  it('fails closed when no published option is supplied', () => {
    const callWithoutOption = buildJoinRequest as unknown as (player: PlayerAccount, clubId: string, option?: PlayerMembershipOption) => unknown;
    expect(() => callWithoutOption(player, 'club-opaque')).toThrow();
  });
});
