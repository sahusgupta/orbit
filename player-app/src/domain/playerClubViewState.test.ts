import { describe, expect, it } from 'vitest';
import type { PlayerClubSnapshot } from './playerSync';
import { deriveClubsViewState, reconcileSelectedClubAfterRefresh } from './playerClubViewState';

const club: PlayerClubSnapshot = {
  club: { id: 'club-refresh', name: 'Synthetic Refresh Venue' },
  games: [], memberships: [], waitlists: [], notifications: [],
  generatedAt: '2026-10-15T12:00:00.000Z'
};

describe('club view state publication readiness', () => {
  it('keeps the empty cold state and first loading state distinct', () => {
    expect(deriveClubsViewState('idle', [], undefined, false, '')).toEqual({ kind: 'empty' });
    expect(deriveClubsViewState('loading', [], undefined, false, '')).toEqual({ kind: 'loading' });
  });

  it('distinguishes an empty offline failure from retained read-only data', () => {
    expect(deriveClubsViewState('error', [], undefined, false, '')).toEqual({ kind: 'offline' });
    const retained = deriveClubsViewState('error', [club], club, true, '');
    expect(retained).toEqual({ kind: 'stale', selectedClub: club, partial: true });
    if (retained.kind === 'stale') expect(retained.selectedClub).toBe(club);
  });

  it('exposes the exact selected snapshot only after a successful publication refresh', () => {
    const ready = deriveClubsViewState('ready', [club], club, true, '');
    expect(ready).toEqual({ kind: 'ready', selectedClub: club, partial: true });
    if (ready.kind === 'ready') expect(ready.selectedClub).toBe(club);
  });

  it('preserves a removed-selection notice without authorizing another room implicitly', () => {
    const removed = reconcileSelectedClubAfterRefresh('removed-club', [club], club.club.id);
    expect(removed).toEqual({ selectedClubId: '', selectionNotice: 'The previously selected club is no longer available.' });
    expect(deriveClubsViewState('ready', [club], undefined, true, removed.selectionNotice))
      .toEqual({ kind: 'removed', message: removed.selectionNotice, partial: true });
  });

  it('keeps an existing selection and leaves the supplied snapshot list unchanged', () => {
    const clubs = [club];
    expect(reconcileSelectedClubAfterRefresh(club.club.id, clubs, 'other-club'))
      .toEqual({ selectedClubId: club.club.id, selectionNotice: '' });
    expect(clubs).toEqual([club]);
    expect(clubs[0]).toBe(club);
  });

  it.each(['idle', 'loading'] as const)('does not authorize a retained selection while the current publication is %s', (status) => {
    expect(deriveClubsViewState(status, [club], club, false, '')).toEqual({ kind: 'loading' });
  });
});
