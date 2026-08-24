/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../domain/state';
import type { AppState } from '../domain/types';
import { createRoomDataExport, downloadTextFile } from './dataExport';

const createExportState = (): AppState => ({
  ...structuredClone(seedState),
  games: [{ id: 'game-export', name: '1/2 Holdem', maxSeats: 9, minInRoomForLikely: 6, minFlexibleForLikely: 2, minTotalForViable: 8 }],
  physicalTables: [{ id: 'physical-1', label: 'Table 1', maxSeats: 8, createdAt: '2026-08-18T12:00:00.000Z' }],
  usageEvents: [{
    id: 'usage-export',
    feature: 'Tables',
    action: 'Opened table',
    route: 'floor',
    timestamp: '2026-08-18T12:00:00.000Z',
    accountKey: 'do-not-export-pilot-code'
  }],
  inAppNotifications: [{
    id: 'notification-export',
    clubId: 'do-not-export-pilot-code',
    gameId: 'game-export',
    title: 'Table forming',
    body: 'A table is forming.',
    reason: 'game-forming',
    createdAt: '2026-08-18T12:00:00.000Z'
  }],
  selfCheckIn: {
    capabilityGeneration: 'export-generation',
    generatedAt: '2026-08-18T12:00:00.000Z'
  },
  profiles: [{
    id: 'profile-export',
    name: 'Export Player',
    phone: '555-0100',
    birthday: '1990-01-01',
    membershipStartDate: '2026-08-01',
    membershipExpirationDate: '2026-09-01',
    totalTimePlayedHours: 4,
    lastSessionTimePlayedHours: 2,
    commonlyPlaysWithProfileIds: [],
    preferredGameId: 'game-export',
    preferredGameIds: ['game-export'],
    gamePlayCounts: { 'game-export': 2 },
    mostPlayedGameId: 'game-export',
    preferredStakes: '1/2',
    typicalBuyInMin: 100,
    typicalBuyInMax: 300,
    willingnessToMove: true,
    typicalAvailability: 'Evenings',
    usualCompanions: [],
    preferredTags: [],
    notes: 'Portable customer record'
  }],
  settings: {
    ...structuredClone(seedState.settings),
    clubAccount: {
      clubName: 'Export Test Club',
      accountName: 'Export Test Account',
      contactName: 'Owner Example',
      email: 'owner@example.test',
      phone: '555-0110',
      address: '1 Test Way'
    },
    pilotAccess: {
      authorized: true,
      authorizationCode: 'DO-NOT-EXPORT-PILOT-CODE',
      expiresAt: '2026-08-17T23:59:59.000Z',
      activatedAt: '2026-07-01T12:00:00.000Z',
      keyFileName: 'private-license.key',
      issuedTo: 'Export Test Club',
      issuedAt: '2026-07-01T12:00:00.000Z',
      licenseId: 'safe-license-id',
      serverManaged: true
    },
    staffAccounts: [{
      id: 'staff-export',
      name: 'Floor Example',
      role: 'Floor',
      pinSalt: 'DO-NOT-EXPORT-PIN-SALT',
      pinHash: 'DO-NOT-EXPORT-PIN-HASH',
      active: true,
      createdAt: '2026-07-01T12:00:00.000Z',
      lastSelectedAt: '2026-08-18T12:00:00.000Z'
    }],
    activeStaffId: 'staff-export',
    accountLogin: {
      username: 'owner@example.test',
      passwordSalt: 'DO-NOT-EXPORT-PASSWORD-SALT',
      passwordHash: 'DO-NOT-EXPORT-PASSWORD-HASH',
      createdAt: '2026-07-01T12:00:00.000Z',
      lastLoginAt: '2026-08-18T12:00:00.000Z'
    }
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('room data export', () => {
  it('exports every room-data collection and safe settings without mutating the source', () => {
    const state = createExportState();
    const before = structuredClone(state);
    const exported = createRoomDataExport(state, '2026-08-18T15:30:00.000Z');

    expect(exported).toMatchObject({
      app: 'Orbit',
      kind: 'room-data-export',
      version: 1,
      exportedAt: '2026-08-18T15:30:00.000Z'
    });
    expect(Object.keys(exported.state).sort()).toEqual(Object.keys(state).sort());
    for (const key of Object.keys(state).filter((key) => !['settings', 'usageEvents', 'inAppNotifications'].includes(key))) {
      expect((exported.state as unknown as Record<string, unknown>)[key]).toEqual(
        (state as unknown as Record<string, unknown>)[key]
      );
    }
    expect(exported.state.settings.clubAccount).toEqual(state.settings.clubAccount);
    expect(exported.state.settings.activeStaffId).toBe('staff-export');
    expect(exported.state.settings.staffAccounts).toEqual([{
      id: 'staff-export',
      name: 'Floor Example',
      role: 'Floor',
      active: true,
      createdAt: '2026-07-01T12:00:00.000Z',
      lastSelectedAt: '2026-08-18T12:00:00.000Z'
    }]);
    expect(exported.state.settings.pilotAccess).toEqual({
      authorized: true,
      expiresAt: '2026-08-17T23:59:59.000Z',
      activatedAt: '2026-07-01T12:00:00.000Z',
      issuedTo: 'Export Test Club',
      issuedAt: '2026-07-01T12:00:00.000Z',
      licenseId: 'safe-license-id',
      serverManaged: true
    });
    expect(exported.state.settings.accountLogin).toEqual({
      username: 'owner@example.test',
      createdAt: '2026-07-01T12:00:00.000Z',
      lastLoginAt: '2026-08-18T12:00:00.000Z'
    });
    expect(exported.state.usageEvents[0].accountKey).toBe('owner-example.test');
    expect(exported.state.inAppNotifications[0].clubId).toBe('owner-example.test');

    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('passwordSalt');
    expect(serialized).not.toContain('passwordHash');
    expect(serialized).not.toContain('pinSalt');
    expect(serialized).not.toContain('pinHash');
    expect(serialized).not.toContain('authorizationCode');
    expect(serialized).not.toContain('keyFileName');
    expect(serialized).not.toContain('DO-NOT-EXPORT');
    expect(serialized.toLowerCase()).not.toContain('do-not-export-pilot-code');
    expect(state).toEqual(before);

    exported.state.games[0].name = 'Changed export only';
    exported.state.settings.clubAccount!.clubName = 'Changed export club';
    expect(state.games[0].name).toBe('1/2 Holdem');
    expect(state.settings.clubAccount?.clubName).toBe('Export Test Club');
  });

  it('replaces legacy authorization-derived identifiers without exporting the authorization code', () => {
    const state = createExportState();
    if (state.settings.pilotAccess) delete state.settings.pilotAccess.licenseId;

    const exported = createRoomDataExport(state, '2026-08-18T15:30:00.000Z');
    expect(exported.state.usageEvents[0].accountKey).toBe('owner-example.test');
    expect(exported.state.inAppNotifications[0].clubId).toBe('owner-example.test');
    expect(JSON.stringify(exported).toLowerCase()).not.toContain('do-not-export-pilot-code');
  });
});

describe('downloadTextFile', () => {
  it('clicks a temporary download anchor, removes it, and revokes the URL on a later task', () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn<(blob: Blob) => string>(() => 'blob:room-export');
    const revokeObjectURL = vi.fn();
    class TestUrl extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', TestUrl);
    let clickedAnchor: HTMLAnchorElement | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clickedAnchor = this;
    });

    const result = downloadTextFile({
      content: '{"ok":true}',
      fileName: 'orbit-room-data-2026-08-18.json',
      mimeType: 'application/json;charset=utf-8'
    });

    expect(result).toEqual({ ok: true });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/json;charset=utf-8');
    expect(clickedAnchor?.download).toBe('orbit-room-data-2026-08-18.json');
    expect(clickedAnchor?.href).toBe('blob:room-export');
    expect(clickedAnchor?.isConnected).toBe(false);
    expect(document.querySelector('a')).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:room-export');
  });

  it('reports a blocked click while still cleaning up the anchor and object URL', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    class TestUrl extends URL {
      static createObjectURL = vi.fn(() => 'blob:blocked-export');
      static revokeObjectURL = revokeObjectURL;
    }
    vi.stubGlobal('URL', TestUrl);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      throw new Error('Download blocked');
    });

    expect(downloadTextFile({ content: 'data', fileName: 'data.json', mimeType: 'application/json' })).toEqual({
      ok: false,
      error: 'Download blocked'
    });
    expect(document.querySelector('a')).toBeNull();
    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:blocked-export');
  });
});
