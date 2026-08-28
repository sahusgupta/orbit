import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState } from '../../domain/types';
import {
  createManagementUndoEntry,
  createManagementUndoSnapshot,
  hasEqualOperationalManagementState,
  hasSameManagementUndoAccount,
  isManagementUndoEntryStale,
  restoreManagementUndoEntry
} from './managementUndo';

const now = '2026-08-28T12:00:00.000Z';

const buildState = (marker: string): AppState => ({
  ...structuredClone(seedState),
  games: [{
    id: 'game-one',
    name: marker,
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 2,
    minTotalForViable: 6
  }],
  feedback: [{ id: `feedback-${marker}`, role: 'Staff', text: marker, createdAt: now }],
  usageEvents: [{
    id: `usage-${marker}`,
    feature: 'Test',
    action: marker,
    route: 'floor',
    timestamp: now,
    accountKey: 'club-one'
  }],
  selfCheckIn: { capabilityGeneration: `generation-${marker}`, generatedAt: now },
  settings: {
    ...structuredClone(seedState.settings),
    lowLight: marker === 'after',
    pilotAccess: {
      authorized: true,
      authorizationCode: 'TT-PILOT-CLUB-ONE',
      expiresAt: '2099-12-31T23:59:59.000Z',
      activatedAt: now,
      licenseId: 'club-one'
    },
    accountLogin: {
      username: `${marker}@example.test`,
      passwordSalt: `salt-${marker}`,
      passwordHash: `hash-${marker}`,
      createdAt: now
    },
    staffAccounts: [{
      id: `staff-${marker}`,
      name: marker,
      role: 'Owner',
      pinSalt: `pin-salt-${marker}`,
      pinHash: `pin-hash-${marker}`,
      active: true,
      createdAt: now
    }],
    activeStaffId: `staff-${marker}`
  }
});

describe('management operational undo', () => {
  it('captures an immutable operational snapshot without auth, audit, or server-managed fields', () => {
    const state = buildState('before');
    const snapshot = createManagementUndoSnapshot(state);

    expect(snapshot.accountKey).toBe('club-one');
    expect(snapshot.operationalState).not.toHaveProperty('usageEvents');
    expect(snapshot.operationalState).not.toHaveProperty('selfCheckIn');
    expect(snapshot.operationalState.settings).not.toHaveProperty('pilotAccess');
    expect(snapshot.operationalState.settings).not.toHaveProperty('accountLogin');
    expect(snapshot.operationalState.settings).not.toHaveProperty('staffAccounts');
    expect(snapshot.operationalState.settings).not.toHaveProperty('activeStaffId');

    state.games[0].name = 'mutated after capture';
    expect(snapshot.operationalState.games[0].name).toBe('before');
  });

  it('restores operational state while preserving the current protected fields', () => {
    const before = buildState('before');
    const after = buildState('after');
    const entry = createManagementUndoEntry(before, after);
    expect(entry).not.toBeNull();

    const current = structuredClone(after);
    current.usageEvents = [{ ...current.usageEvents[0], id: 'current-usage', action: 'Current audit' }];
    current.selfCheckIn = { capabilityGeneration: 'current-generation', generatedAt: '2026-08-28T13:00:00.000Z' };
    current.settings.pilotAccess = { ...current.settings.pilotAccess!, expiresAt: '2098-01-01T00:00:00.000Z' };
    current.settings.accountLogin = { ...current.settings.accountLogin!, passwordHash: 'current-hash' };
    current.settings.staffAccounts = [{ ...current.settings.staffAccounts[0], name: 'Current operator' }];
    current.settings.activeStaffId = current.settings.staffAccounts[0].id;

    const restored = restoreManagementUndoEntry(current, entry!);

    expect(restored?.games).toEqual(before.games);
    expect(restored?.feedback).toEqual(before.feedback);
    expect(restored?.settings.lowLight).toBe(before.settings.lowLight);
    expect(restored?.usageEvents).toBe(current.usageEvents);
    expect(restored?.selfCheckIn).toBe(current.selfCheckIn);
    expect(restored?.settings.pilotAccess).toBe(current.settings.pilotAccess);
    expect(restored?.settings.accountLogin).toBe(current.settings.accountLogin);
    expect(restored?.settings.staffAccounts).toBe(current.settings.staffAccounts);
    expect(restored?.settings.activeStaffId).toBe(current.settings.activeStaffId);
  });

  it('treats protected-only changes as equal and not stale', () => {
    const before = buildState('before');
    const after = buildState('after');
    const entry = createManagementUndoEntry(before, after)!;
    const current = structuredClone(after);
    current.usageEvents = [];
    current.selfCheckIn = undefined;
    current.settings.accountLogin = undefined;
    current.settings.activeStaffId = undefined;
    current.settings.staffAccounts = [];
    current.settings.pilotAccess = { ...current.settings.pilotAccess!, expiresAt: '2098-01-01T00:00:00.000Z' };

    expect(hasSameManagementUndoAccount(current, entry.after)).toBe(true);
    expect(hasEqualOperationalManagementState(current, entry.after)).toBe(true);
    expect(isManagementUndoEntryStale(current, entry)).toBe(false);
  });

  it('rejects restore after a newer operational change', () => {
    const before = buildState('before');
    const after = buildState('after');
    const entry = createManagementUndoEntry(before, after)!;
    const current = structuredClone(after);
    current.games = [{ ...current.games[0], name: 'newer synced game name' }];

    expect(isManagementUndoEntryStale(current, entry)).toBe(true);
    expect(restoreManagementUndoEntry(current, entry)).toBeNull();
  });

  it('rejects cross-account entries and ignores operational no-ops', () => {
    const before = buildState('before');
    const sameOperations = buildState('before');
    sameOperations.usageEvents = [];
    sameOperations.settings.accountLogin = undefined;
    expect(createManagementUndoEntry(before, sameOperations)).toBeNull();

    const otherAccount = buildState('after');
    otherAccount.settings.pilotAccess = {
      ...otherAccount.settings.pilotAccess!,
      authorizationCode: 'TT-PILOT-CLUB-TWO',
      licenseId: 'club-two'
    };
    expect(createManagementUndoEntry(before, otherAccount)).toBeNull();

    const entry = createManagementUndoEntry(before, buildState('after'))!;
    expect(hasSameManagementUndoAccount(otherAccount, entry.after)).toBe(false);
    expect(isManagementUndoEntryStale(otherAccount, entry)).toBe(true);
    expect(restoreManagementUndoEntry(otherAccount, entry)).toBeNull();
  });
});
