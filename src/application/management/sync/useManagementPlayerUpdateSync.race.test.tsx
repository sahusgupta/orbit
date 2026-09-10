// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState } from '../../../domain/types';
import * as persistence from '../../../app/persistence/managementPersistence';
import { useManagementPlayerUpdateSync } from './useManagementPlayerUpdateSync';

vi.mock('../../../app/persistence/managementPersistence', () => ({
  hasManagementDesktopPersistence: vi.fn(),
  loadDesktopManagementStateForAccount: vi.fn(),
  loadManagementStateFromLocalBridge: vi.fn(),
  publishStateToLocalOrbitBridge: vi.fn()
}));

describe.each(['desktop', 'browser'] as const)('%s poll ordering', (mode) => {
  let root: Root;
  let container: HTMLDivElement;
  let stateRef: { current: AppState };
  let savePending: boolean;
  let resolveLoad: (state: AppState, authoritative?: boolean) => void;
  const setState = vi.fn();
  const clearUndo = vi.fn();
  const setSaveStatus = vi.fn();
  const loader = mode === 'desktop' ? persistence.loadDesktopManagementStateForAccount : persistence.loadManagementStateFromLocalBridge;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    savePending = false;
    stateRef = { current: structuredClone(seedState) };
    stateRef.current.settings.pilotAccess = { authorized: true, licenseId: 'sync-test', authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
    stateRef.current.playerSessions = [{ id: 'player', playerName: 'Test', tableId: 'table', gameId: 'game', seatedAt: '2026-09-10T00:00:00.000Z', timePurchasedMinutes: 60, timeRemainingMinutes: 60, timeFeeEnabled: true }];
    vi.mocked(persistence.hasManagementDesktopPersistence).mockReturnValue(mode === 'desktop');
    vi.mocked(persistence.loadDesktopManagementStateForAccount).mockImplementation(() => new Promise((resolve) => {
      resolveLoad = (state, authoritative = true) => resolve({ state, authoritative, schemaVersion: 5, savedAt: '2026-09-10T00:00:00.000Z' });
    }));
    vi.mocked(persistence.loadManagementStateFromLocalBridge).mockImplementation(() => new Promise((resolve) => {
      resolveLoad = (state) => resolve({ status: 'available', state });
    }));
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); localStorage.clear(); });
  const mount = async () => {
    function Harness() {
      useManagementPlayerUpdateSync({ activeAccountKey: 'sync-test', announceIncomingPlayerRequest: vi.fn(), hasAuthenticated: true,
        isManagementSavePending: () => savePending, setSaveStatus, setState, clearUndo, state: stateRef.current, stateRef });
      return null;
    }
    await act(async () => root.render(<Harness />));
  };
  const withBalance = (minutes: number): AppState => ({ ...stateRef.current, playerSessions: stateRef.current.playerSessions.map((p) => ({ ...p, timeRemainingMinutes: minutes })) });
  it('accepts a fresh authoritative response', async () => {
    await mount();
    await act(async () => resolveLoad(withBalance(90)));
    expect(stateRef.current.playerSessions[0].timeRemainingMinutes).toBe(90);
    expect(setState).toHaveBeenCalledTimes(1);
    expect(clearUndo).toHaveBeenCalledTimes(1);
  });
  it('discards a read started before a newer local action', async () => {
    await mount();
    const oldState = stateRef.current;
    stateRef.current = withBalance(90);
    await act(async () => resolveLoad(oldState));
    expect(stateRef.current.playerSessions[0].timeRemainingMinutes).toBe(90);
    expect(setState).not.toHaveBeenCalled();
    expect(clearUndo).not.toHaveBeenCalled();
  });
  it('does not poll while an account save is pending', async () => {
    savePending = true;
    await mount();
    expect(loader).not.toHaveBeenCalled();
  });
  it('does not overlap slow polls', async () => {
    await mount();
    await act(async () => vi.advanceTimersByTime(6000));
    expect(loader).toHaveBeenCalledTimes(1);
  });
  if (mode === 'desktop') it('rejects offline cache snapshots', async () => {
    await mount();
    await act(async () => resolveLoad(withBalance(0), false));
    expect(stateRef.current.playerSessions[0].timeRemainingMinutes).toBe(60);
    expect(setState).not.toHaveBeenCalled();
    expect(setSaveStatus).not.toHaveBeenCalled();
  });
});
