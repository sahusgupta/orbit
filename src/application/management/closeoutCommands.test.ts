import { describe, expect, it } from 'vitest';
import { seedState } from '../../domain/state';
import type { NightCloseTable } from '../../lib/nightClose';
import type { AppState, NightCloseRecord } from '../../domain/types';
import {
  getNightCloseLockError,
  getNightCloseReopenError,
  lockNightClose,
  reopenNightClose,
  saveNightClose,
  signNightClose
} from './closeoutCommands';

const now = '2026-08-08T22:00:00.000Z';
const table: NightCloseTable = {
  tableId: 'table-close', tableLabel: 'Close Table', gameName: 'Holdem', buyIns: 500, cashOuts: 480,
  drop: 20, timeFees: 0, expectedCash: 20, actualCash: 20, discrepancy: 0, warnings: ['Table is still open']
};
const staff = { id: 'staff-manager', name: 'Manager One', role: 'Manager' as const, pinSalt: 'salt', pinHash: 'hash', active: true, createdAt: now };
const state = (overrides: Partial<AppState> = {}): AppState => ({
  ...structuredClone(seedState),
  games: [{ id: 'game', name: 'Holdem', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 3, minTotalForViable: 6 }],
  sessions: [{ id: 'table-close', gameId: 'game', label: 'Close Table', status: 'Running', seatsFilled: 1, maxSeats: 8, tags: [], startedAt: now }],
  playerSessions: [{ id: 'session', playerName: 'Player', gameId: 'game', tableId: 'table-close', seatedAt: now }],
  interests: [{ id: 'interest', playerName: 'Player', gameId: 'game', status: 'Seated', tableId: 'table-close', timestamp: now, interestedAt: now, notes: '' }],
  nightCloses: [],
  history: [],
  tableEvents: [],
  settings: { ...structuredClone(seedState.settings), activeStaffId: staff.id, staffAccounts: [staff] },
  ...overrides
});
const dependencies = () => {
  let nextId = 0;
  return { createId: () => `created-${++nextId}`, nowIso: () => now, todayDate: () => '2026-08-08' };
};
const inputs = (current?: NightCloseRecord, tables: NightCloseTable[] = [table]) => ({
  current, tables, warnings: tables.flatMap((item) => item.warnings.map((warning) => `${item.tableLabel}: ${warning}`)), notes: 'Counted'
});
const currentNight = {
  id: 'current', date: '2026-08-08', occupiedSeatHours: 4, gamesStarted: 1,
  averageSessionDurationHours: 4, averageActiveTables: 1, waitlistConversionRate: 1, hadTwoPlusTables: false
};

describe('management closeout commands', () => {
  it('creates and updates drafts with exact audit and replacement order, while locked records are immutable', () => {
    const source = state();
    const snapshot = structuredClone(source);
    const created = saveNightClose(source, inputs(), 'Draft', dependencies());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.record).toMatchObject({
      id: 'created-2', date: '2026-08-08', status: 'Draft', createdAt: now, updatedAt: now,
      notes: 'Counted', tables: [table], warnings: ['Close Table: Table is still open']
    });
    expect(created.record.audit).toEqual([expect.objectContaining({ id: 'created-1', action: 'Created', timestamp: now, staffId: staff.id })]);
    const saved = saveNightClose(created.state, { ...inputs(created.record), notes: 'Recounted' }, 'Draft', dependencies());
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.record.id).toBe(created.record.id);
      expect(saved.record.notes).toBe('Recounted');
      expect(saved.record.audit.map((entry) => entry.action)).toEqual(['Created', 'Saved']);
    }
    const locked = { ...created.record, status: 'Locked' as const };
    expect(saveNightClose(created.state, inputs(locked), 'Locked', dependencies())).toMatchObject({ ok: false, code: 'locked' });
    expect(source).toEqual(snapshot);
  });

  it('returns explicit sign failures and creates a canonical staff sign-off', () => {
    const noStaff = state({ settings: { ...structuredClone(seedState.settings), staffAccounts: [] } });
    expect(signNightClose(noStaff, inputs(), { discrepancy: 0 }, dependencies())).toMatchObject({ ok: false, code: 'missing-staff' });
    expect(signNightClose(state(), inputs(undefined, []), { discrepancy: 0 }, dependencies())).toMatchObject({ ok: false, code: 'missing-tables' });
    expect(signNightClose(state(), inputs(undefined, [{ ...table, actualCash: undefined }]), { discrepancy: 0 }, dependencies())).toMatchObject({ ok: false, code: 'missing-actual' });

    const signed = signNightClose(state(), inputs(), { discrepancy: -1.25 }, dependencies());
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.record).toMatchObject({ id: 'created-2', status: 'Staff Signed', createdAt: now, updatedAt: now });
    expect(signed.record.staffSignOff).toMatchObject({ id: 'created-1', action: 'Staff Signed', note: 'Discrepancy -1.25' });
    expect(signed.record.managerSignOff).toBeUndefined();
  });

  it('validates managers and locks every operational boundary with stable ID order', () => {
    const signedResult = signNightClose(state(), inputs(), { discrepancy: 0 }, dependencies());
    if (!signedResult.ok) throw new Error('Expected signed close');
    const signed = signedResult.record;
    const floorState = {
      ...signedResult.state,
      settings: { ...signedResult.state.settings, staffAccounts: [{ ...staff, role: 'Floor' as const }] }
    };
    expect(getNightCloseLockError(floorState, signed)).toBe('A Manager or Owner must be selected to approve and lock the night.');
    expect(getNightCloseLockError(state(), { ...signed, status: 'Draft' })).toBe('Staff sign-off is required before manager approval.');

    const result = lockNightClose(signedResult.state, { ...inputs(signed), current: signed }, { discrepancy: 0 }, currentNight, dependencies());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toMatchObject({ status: 'Locked', updatedAt: now, lockedAt: now, warnings: [] });
    expect(result.record.managerSignOff).toMatchObject({ id: 'created-1', action: 'Manager Approved', note: 'Locked with discrepancy 0.00' });
    expect(result.state.history).toEqual([{ ...currentNight, id: 'created-2', notes: 'Counted' }]);
    expect(result.state.interests).toEqual([]);
    expect(result.state.sessions[0]).toMatchObject({ status: 'Closed', endedAt: now });
    expect(result.state.playerSessions[0]).toMatchObject({ leftAt: now });
    expect(result.state.tableEvents[0]).toMatchObject({ id: 'created-3', type: 'Closed', tableId: 'table-close', timestamp: now });
  });

  it('validates reopen authority and appends a reasoned audit without restoring cleared room state', () => {
    const signedResult = signNightClose(state(), inputs(), { discrepancy: 0 }, dependencies());
    if (!signedResult.ok) throw new Error('Expected signed close');
    const lockedResult = lockNightClose(signedResult.state, { ...inputs(signedResult.record), current: signedResult.record }, { discrepancy: 0 }, currentNight, dependencies());
    if (!lockedResult.ok) throw new Error('Expected locked close');
    expect(getNightCloseReopenError(state({ settings: { ...structuredClone(seedState.settings), staffAccounts: [] } }), lockedResult.record))
      .toBe('A Manager or Owner must be selected to reopen a close.');

    const reopened = reopenNightClose(lockedResult.state, lockedResult.record, 'Recounted cash', dependencies());
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.record).toMatchObject({ status: 'Draft', updatedAt: now, lockedAt: undefined, managerSignOff: undefined });
    expect(reopened.record.audit.at(-1)).toMatchObject({ id: 'created-1', action: 'Reopened', note: 'Recounted cash' });
    expect(reopened.state.interests).toEqual([]);
    expect(reopened.state.sessions[0].status).toBe('Closed');
  });
});
