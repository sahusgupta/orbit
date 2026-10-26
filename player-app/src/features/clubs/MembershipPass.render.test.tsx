/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount, PlayerClubSnapshot, PlayerMembership } from '../../domain/playerSync';
import { MembershipPassCard, MembershipPassWallet } from './MembershipPass';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const flatten = (style: unknown): Record<string, unknown> => Array.isArray(style)
    ? Object.assign({}, ...style.map(flatten))
    : style && typeof style === 'object' ? style as Record<string, unknown> : {};
  const native = (tag: string) => ({ children, style, pointerEvents: _pointerEvents, numberOfLines: _numberOfLines, adjustsFontSizeToFit: _adjustsFontSizeToFit }: Record<string, unknown>) => {
    const resolved = flatten(style);
    return ReactModule.createElement(tag, {
      'data-min-height': resolved.minHeight,
      'data-color': resolved.color,
      'data-background': resolved.backgroundColor
    }, children as React.ReactNode);
  };
  const Pressable = ({ children, style, onPress, accessibilityLabel, accessibilityRole, accessibilityState }: Record<string, unknown>) => {
    const [pressed, setPressed] = ReactModule.useState(false);
    const resolved = flatten(typeof style === 'function' ? style({ pressed }) : style);
    const selected = accessibilityState && typeof accessibilityState === 'object' && 'selected' in accessibilityState ? accessibilityState.selected : undefined;
    return ReactModule.createElement('button', {
      onClick: onPress,
      onMouseDown: () => setPressed(true),
      onMouseUp: () => setPressed(false),
      'aria-label': accessibilityLabel,
      role: accessibilityRole,
      'aria-selected': selected,
      'data-height': resolved.height,
      'data-min-height': resolved.minHeight,
      'data-margin-top': resolved.marginTop,
      'data-opacity': resolved.opacity
    }, children as React.ReactNode);
  };
  return {
    View: native('div'), Text: native('span'), Pressable,
    StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1, absoluteFillObject: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } }
  };
});
vi.mock('expo-linear-gradient', () => ({
  LinearGradient: ({ colors }: { colors: string[] }) => <div data-testid="card-finish" data-colors={colors.join(',')} />
}));

const nowMs = Date.parse('2026-10-20T12:00:00.000Z');
const player: PlayerAccount = { id: 'player-1', name: 'Alex Example', email: 'alex@example.test', preferredGameIds: [] };
const membership: PlayerMembership = {
  id: 'published-membership-1', clubId: 'club-1', playerId: player.id, playerName: player.name,
  status: 'Active', planName: 'Annual access', preferredGameIds: []
};
const club: PlayerClubSnapshot = {
  club: { id: 'club-1', name: 'River Room' }, memberships: [membership], games: [], waitlists: [], notifications: [], generatedAt: new Date(nowMs).toISOString()
};

describe('Metallic membership passes', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  function renderWallet(clubs = [club], onSelectClub = vi.fn(), selectedClubId?: string) {
    act(() => root.render(<MembershipPassWallet clubs={clubs} player={player} nowMs={nowMs} onSelectClub={onSelectClub} selectedClubId={selectedClubId} />));
    return onSelectClub;
  }

  it('opens the selected published club and marks its pass as selected', () => {
    const onSelectClub = renderWallet([club], vi.fn(), club.club.id);
    const button = container.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe('River Room, Active');
    expect(button?.getAttribute('role')).toBe('button');
    expect(button?.getAttribute('aria-selected')).toBe('true');
    act(() => button?.click());
    expect(onSelectClub).toHaveBeenCalledExactlyOnceWith(club);
  });

  it('keeps every pass in the supplied order when there are more than five', () => {
    const clubs = [6, 2, 5, 0, 4, 1, 3].map((index): PlayerClubSnapshot => ({
      ...club, club: { id: `club-${index}`, name: `Room ${index}` },
      memberships: [{ ...membership, id: `membership-${index}`, clubId: `club-${index}` }]
    }));
    renderWallet(clubs);
    expect(Array.from(container.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual(clubs.map((item) => `${item.club.name}, Active`));
    expect(container.querySelectorAll('[data-testid="card-finish"]')).toHaveLength(7);
  });

  it('shows only memberships belonging to this player and their enclosing club', () => {
    renderWallet([{ ...club, memberships: [
      { ...membership, id: 'foreign-player', playerId: 'player-2' },
      { ...membership, id: 'wrong-club', clubId: 'club-2' },
      { ...membership, id: 'legacy-name-only', playerId: '' },
      membership,
      { ...membership, id: 'second-published-pass', status: 'Expired' }
    ] }]);
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.textContent).toContain(membership.id);
    expect(container.textContent).not.toContain('second-published-pass');
    expect(container.textContent).not.toContain('foreign-player');
    expect(container.textContent).not.toContain('wrong-club');
    expect(container.textContent).not.toContain('legacy-name-only');
  });

  it('renders no wallet when no owned membership has been published', () => {
    renderWallet([{ ...club, memberships: [{ ...membership, playerId: 'other-player' }] }]);
    expect(container.children).toHaveLength(0);
  });

  it.each([
    { status: 'Requested' as const, expiresAt: undefined, expected: 'Requested' },
    { status: 'Approved' as const, expiresAt: undefined, expected: 'Approved' },
    { status: 'Expired' as const, expiresAt: undefined, expected: 'Expired' },
    { status: 'Active' as const, expiresAt: new Date(nowMs).toISOString(), expected: 'Expired' },
    { status: 'Active' as const, expiresAt: 'invalid-date', expected: 'Expired' },
    { status: 'Active' as const, expiresAt: new Date(nowMs + 1).toISOString(), expected: 'Active' }
  ])('uses the existing $expected access boundary for $status membership', ({ status, expiresAt, expected }) => {
    renderWallet([{ ...club, memberships: [{ ...membership, status, expiresAt }] }]);
    expect(container.querySelector('button')?.getAttribute('aria-label')).toBe(`River Room, ${expected}`);
    expect(container.textContent).toContain(expected);
  });

  it('leaves a readable title and status strip with an accessible touch target for each rear pass', () => {
    renderWallet([club, { ...club, club: { id: 'club-2', name: 'Second Room' }, memberships: [{ ...membership, clubId: 'club-2' }] }]);
    const [rear, front] = Array.from(container.querySelectorAll('button'));
    const exposedHeight = Number(rear.getAttribute('data-height')) + Number(front.getAttribute('data-margin-top'));
    expect(exposedHeight).toBeGreaterThanOrEqual(72);
    expect(Number(rear.getAttribute('data-min-height'))).toBeGreaterThanOrEqual(44);
    expect(rear.textContent).toContain('River Room');
    expect(rear.textContent).toContain('Active');
    expect(Number(front.getAttribute('data-height'))).toBe(244);
  });

  it('shows published pass details without inventing a member number or benefits', () => {
    act(() => root.render(<MembershipPassCard club={club} membership={membership} player={player} nowMs={nowMs} />));
    expect(container.textContent).toContain('River Room');
    expect(container.textContent).toContain('ANNUAL ACCESS');
    expect(container.textContent).toContain(player.name);
    expect(container.textContent).toContain(`MEMBERSHIP ID${membership.id}`);
    expect(container.textContent).not.toContain('Gold Member');
    expect(container.textContent).not.toContain('Priority seating');
    expect(container.textContent).not.toContain('Member number');
    expect(Number(container.firstElementChild?.getAttribute('data-min-height'))).toBeGreaterThanOrEqual(280);
  });

  it('uses the published-plan fallback and retains the finish for a renamed club', () => {
    act(() => root.render(<MembershipPassCard club={club} membership={{ ...membership, planName: ' ' }} player={player} nowMs={nowMs} />));
    const initialFinish = container.querySelector('[data-testid="card-finish"]')?.getAttribute('data-colors');
    expect(container.textContent).toContain('MEMBERSHIP ACCESS');
    act(() => root.render(<MembershipPassCard club={{ ...club, club: { ...club.club, name: 'Renamed Room' } }} membership={membership} player={player} nowMs={nowMs} />));
    expect(container.querySelector('[data-testid="card-finish"]')?.getAttribute('data-colors')).toBe(initialFinish);
  });

  it('gives a pressed pass visual feedback', () => {
    renderWallet();
    const button = container.querySelector('button');
    act(() => button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(button?.getAttribute('data-opacity')).toBe('0.88');
    act(() => button?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    expect(button?.getAttribute('data-opacity')).toBeNull();
  });
});
