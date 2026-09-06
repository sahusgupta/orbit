/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MembershipQrCredential } from '../../domain/membershipQr';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembership } from '../../domain/playerSync';
import { MembershipWalletCard } from './MembershipWallet';

const api = vi.hoisted(() => ({
  issue: vi.fn<(clubId: string, mutationId: string, playerId: string) => Promise<MembershipQrCredential>>(),
  currentPlayer: vi.fn<() => { uid: string } | null>()
}));

vi.mock('../../data/orbitSyncApi', () => ({
  issueRemoteMembershipQr: api.issue,
  getCurrentFirebasePlayer: api.currentPlayer
}));
vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, disabled, accessibilityLabel, accessibilityLiveRegion }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      disabled,
      onClick: onPress,
      'aria-label': accessibilityLabel,
      'aria-live': accessibilityLiveRegion
    }, children as React.ReactNode);
  return {
    Platform: { OS: 'ios' },
    Pressable: element('button'), Text: element('span'), View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}));
vi.mock('react-native-qrcode-svg', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr-code" data-value={value} />
}));

const nowMs = Date.parse('2026-09-06T12:00:00Z');
const player: PlayerAccount = { id: 'player-1', name: 'Release Reviewer', email: 'reviewer@example.invalid', preferredGameIds: [] };
const membership: PlayerMembership = {
  id: 'membership-1', clubId: 'club-1', playerId: player.id, playerName: player.name,
  status: 'Active', plan: 'monthly', paymentMethod: 'core', requestedAt: '2026-09-01T00:00:00Z',
  loyalty: { clubId: 'club-1', points: 0, lifetimeHours: 0, tier: 'New', nextTierAtHours: 12 },
  preferredGameIds: []
};
const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'First Review Venue' }, games: [], memberships: [membership],
  waitlists: [], notifications: [], generatedAt: new Date(nowMs).toISOString()
};
const nextClub: PlayerClubSnapshot = { ...club, club: { id: 'club-2', name: 'Second Review Venue' } };
const credential: MembershipQrCredential = {
  token: 'synthetic-venue-one-code', issuedAt: new Date(nowMs).toISOString(),
  expiresAt: new Date(nowMs + 120_000).toISOString()
};

describe('membership wallet QR lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    api.issue.mockReset().mockResolvedValue(credential);
    api.currentPlayer.mockReset().mockReturnValue({ uid: player.id });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(selectedClub = club, clock = nowMs, account = player) {
    act(() => root.render(<MembershipWalletCard
      club={selectedClub} membership={{ ...membership, clubId: selectedClub.club.id, playerId: account.id }}
      nowMs={clock} player={account}
    />));
  }
  function button() {
    const button = container.querySelector('button');
    if (!button) throw new Error('Expected the check-in code action.');
    return button;
  }
  async function issue() {
    await act(async () => button().click());
  }
  function qrValue() {
    return container.querySelector('[data-testid="qr-code"]')?.getAttribute('data-value');
  }

  it('shows a server-issued code only until its expiry and creates a new code on refresh', async () => {
    render();
    expect(qrValue()).toBeUndefined();
    await issue();
    expect(api.issue).toHaveBeenCalledWith(club.club.id, expect.any(String), player.id);
    expect(qrValue()).toBe(credential.token);
    render(club, nowMs + 120_000);
    expect(qrValue()).toBeUndefined();
    expect(container.textContent).toContain('This check-in code expired');
    await issue();
    expect(api.issue.mock.calls[1]?.[1]).not.toBe(api.issue.mock.calls[0]?.[1]);
  });

  it('retries a failed request with the same mutation identifier', async () => {
    api.issue.mockRejectedValueOnce(new Error('Network unavailable'));
    render();
    await issue();
    expect(qrValue()).toBeUndefined();
    expect(container.textContent).toContain('Network unavailable');
    await issue();
    expect(api.issue.mock.calls[1]).toEqual(api.issue.mock.calls[0]);
    expect(qrValue()).toBe(credential.token);
  });

  it('discards the displayed QR when the selected venue changes', async () => {
    render();
    await issue();
    expect(qrValue()).toBe(credential.token);
    render(nextClub);
    expect(container.textContent).toContain(nextClub.club.name);
    expect(qrValue()).toBeUndefined();
    expect(button().textContent).toBe('Generate check-in code');
    api.issue.mockResolvedValueOnce({ ...credential, token: 'synthetic-venue-two-code' });
    await issue();
    expect(api.issue.mock.calls[1]?.[0]).toBe(nextClub.club.id);
    expect(qrValue()).toBe('synthetic-venue-two-code');
  });

  it('does not reuse an in-flight request or its response after a venue switch', async () => {
    let resolvePrior!: (result: MembershipQrCredential) => void;
    api.issue.mockReturnValueOnce(new Promise((resolve) => { resolvePrior = resolve; }));
    render();
    await issue();
    expect(button().disabled).toBe(true);
    render(nextClub);
    expect(button().disabled).toBe(false);
    await act(async () => resolvePrior(credential));
    expect(qrValue()).toBeUndefined();
    await issue();
    expect(api.issue.mock.calls[1]?.[0]).toBe(nextClub.club.id);
    expect(api.issue.mock.calls[1]?.[1]).not.toBe(api.issue.mock.calls[0]?.[1]);
  });

  it('does not display a response when the authenticated account changed during issuance', async () => {
    let resolvePrior!: (result: MembershipQrCredential) => void;
    api.issue.mockReturnValueOnce(new Promise((resolve) => { resolvePrior = resolve; }));
    render();
    await issue();
    api.currentPlayer.mockReturnValue({ uid: 'player-2' });
    render(club, nowMs, { ...player, id: 'player-2' });
    await act(async () => resolvePrior(credential));
    expect(qrValue()).toBeUndefined();
    expect(button().disabled).toBe(false);
  });
});
