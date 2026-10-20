/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembership } from '../../domain/playerSync';
import { deriveClubsViewState, type PlayerClubsViewState } from '../../domain/playerClubViewState';
import { MembershipDetailsScreen } from './MembershipDetailsScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, accessibilityLabel, accessibilityRole, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {})
    }, children as React.ReactNode);
  return { Platform: { OS: 'web' }, Pressable: element('button'), Text: element('span'), View: element('div'), StyleSheet: { create: <T,>(styles: T) => styles } };
});
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span /> }));
vi.mock('../../components/PlayerPresentation', () => ({
  AnimatedButton: ({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button>
}));
vi.mock('./ClubHub', () => ({ PlayerTimePanel: () => <div data-testid="player-time">Published table time</div> }));
vi.mock('./MembershipWallet', () => ({
  MembershipWalletCard: ({ demoMode }: { demoMode?: boolean }) => <div data-testid="wallet" data-demo={String(demoMode)}><button>Generate check-in code</button></div>,
  MembershipApplicationStatusCard: () => <div data-testid="application">Application received</div>
}));

const player: PlayerAccount = { id: 'player-1', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] };
const membership: PlayerMembership = {
  id: 'membership-1', clubId: 'club-1', playerId: player.id, playerName: player.name,
  status: 'Active', planName: 'Annual access', membershipDurationDays: 365,
  expiresAt: '2026-11-20T12:00:00.000Z', preferredGameIds: []
};
const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'River Room', membershipOptions: [{ id: 'annual', name: 'Annual access', priceLabel: 'Ask venue', durationDays: 365 }] },
  games: [], memberships: [membership], waitlists: [], notifications: [], generatedAt: '2026-10-20T00:00:00.000Z'
};

describe('Dedicated membership details', () => {
  let container: HTMLDivElement;
  let root: Root;
  const nowMs = Date.parse('2026-10-20T12:00:00.000Z');
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  function render(viewState: PlayerClubsViewState, onManageAccess = vi.fn(), onBack = vi.fn(), demoMode = false) {
    act(() => root.render(<MembershipDetailsScreen viewState={viewState} player={player} nowMs={nowMs} message=""
      onBack={onBack} onManageAccess={onManageAccess} demoMode={demoMode} />));
    return { onManageAccess, onBack };
  }
  const ready = (currentClub = club) => deriveClubsViewState('ready', [currentClub], currentClub, false, '');

  it('shows the published plan and expiry with a separate extension request action', () => {
    const { onManageAccess, onBack } = render(ready());
    expect(container.textContent).toContain('Annual access');
    expect(container.textContent).toContain('365-day membership');
    expect(container.textContent).toContain('2026');
    expect(container.textContent).toContain('The venue confirms your extension and expiry.');
    expect(container.querySelector('[data-testid="wallet"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="player-time"]')).not.toBeNull();
    const extension = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Extend membership');
    expect(extension).toBeDefined();
    act(() => extension?.click());
    expect(onManageAccess).toHaveBeenCalledOnce();
    act(() => (container.querySelector('[aria-label="Back to memberships"]') as HTMLButtonElement).click());
    expect(onBack).toHaveBeenCalledOnce();
    expect(membership.expiresAt).toBe('2026-11-20T12:00:00.000Z');
  });

  it.each([
    { kind: 'loading' } as PlayerClubsViewState,
    { kind: 'offline' } as PlayerClubsViewState,
    { kind: 'empty' } as PlayerClubsViewState,
    { kind: 'stale', selectedClub: club, partial: false } as PlayerClubsViewState,
    { kind: 'removed', selectedClub: club, message: 'Club no longer available.', partial: false } as PlayerClubsViewState
  ])('removes QR, extension and time panels when the view is $kind', (state) => {
    render(ready());
    const { onManageAccess } = render(state);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wallet"]')).toBeNull();
    expect(container.querySelector('[data-testid="player-time"]')).toBeNull();
    expect(container.textContent).not.toContain('Extend membership');
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(onManageAccess).not.toHaveBeenCalled();
  });

  it('shows expired membership status without advancing its published expiry', () => {
    const expired = { ...club, memberships: [{ ...membership, expiresAt: '2026-10-19T12:00:00.000Z' }] };
    render(ready(expired));
    expect(container.textContent).toContain('Expired');
    expect(container.textContent).toContain('Extend membership');
    expect(expired.memberships[0].expiresAt).toBe('2026-10-19T12:00:00.000Z');
  });

  it('shows pending applications without QR or duplicate extension requests', () => {
    const requested = { ...club, memberships: [{ ...membership, status: 'Requested' as const }] };
    render(ready(requested));
    expect(container.querySelector('[data-testid="application"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wallet"]')).toBeNull();
    expect(container.textContent).not.toContain('Extend membership');
    expect(container.textContent).toContain('Venue staff will confirm your access request');
  });

  it('does not offer extension without published options and never displays another player membership', () => {
    render(ready({ ...club, club: { ...club.club, membershipOptions: [] } }));
    expect(container.textContent).not.toContain('Extend membership');
    expect(container.textContent).toContain('Contact the venue to extend your membership');
    render(ready({ ...club, memberships: [{ ...membership, playerId: 'other-player' }] }));
    expect(container.querySelector('[data-testid="wallet"]')).toBeNull();
    expect(container.textContent).not.toContain('Annual access');
    expect(container.textContent).toContain('No membership has been published for your profile.');
  });

  it('forwards demo mode to the existing wallet guard', () => {
    render(ready(), vi.fn(), vi.fn(), true);
    expect(container.querySelector('[data-testid="wallet"]')?.getAttribute('data-demo')).toBe('true');
  });
});
