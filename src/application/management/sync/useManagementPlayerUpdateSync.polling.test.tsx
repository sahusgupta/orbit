// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState, PersistedStateRecord } from '../../../domain/types';
import type { ManagementStateSubscriptionEvent } from '../../../app/persistence/managementPersistence';
import * as persistence from '../../../app/persistence/managementPersistence';
import { useManagementPlayerUpdateSync } from './useManagementPlayerUpdateSync';

vi.mock('../../../app/persistence/managementPersistence', () => ({
  hasManagementDesktopPersistence: vi.fn(), loadDesktopManagementStateForAccount: vi.fn(),
  subscribeToDesktopManagementStateForAccount: vi.fn(), loadManagementStateFromLocalBridge: vi.fn(),
  publishStateToLocalOrbitBridge: vi.fn()
}));

describe('desktop authoritative updates', () => {
  let root: Root;
  let container: HTMLDivElement;
  let stateRef: { current: AppState };
  let savePending: boolean;
  let hidden: boolean;
  let revision: number;
  let listener: ((event: ManagementStateSubscriptionEvent) => void) | undefined;
  const load = vi.mocked(persistence.loadDesktopManagementStateForAccount);
  const subscribe = vi.mocked(persistence.subscribeToDesktopManagementStateForAccount);
  const cleanup = vi.fn();
  const setState = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers(); vi.resetAllMocks();
    vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
    savePending = false; hidden = false; revision = 1; listener = undefined;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    stateRef = { current: structuredClone(seedState) };
    stateRef.current.settings.pilotAccess = {
      authorized: true, licenseId: 'poll-test', authorizationCode: 'test-only',
      activatedAt: '2026-10-28', expiresAt: '2099-12-31'
    };
    vi.mocked(persistence.hasManagementDesktopPersistence).mockReturnValue(true);
    load.mockImplementation(async () => record());
    subscribe.mockImplementation((_access, callback) => {
      listener = callback;
      callback({ type: 'status', connected: true });
      return cleanup;
    });
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); localStorage.clear();
    vi.restoreAllMocks(); vi.useRealTimers();
  });
  const record = (): PersistedStateRecord => ({
    state: structuredClone(stateRef.current), authoritative: true, revision,
    schemaVersion: 5, savedAt: '2026-10-28T12:00:00.000Z'
  });
  const changedRecord = (id = 'new'): PersistedStateRecord => ({
    ...record(), state: { ...structuredClone(stateRef.current), staffRequests: [{ id, type: 'self-check-in-assistance', playerName: 'Synthetic', reason: 'not-found', status: 'pending', createdAt: '2026-10-28T12:00:00.000Z' }] }
  });
  function Harness() {
    useManagementPlayerUpdateSync({
      activeAccountKey: 'poll-test', hasAuthenticated: true,
      announceIncomingPlayerRequest: vi.fn(), isManagementSavePending: () => savePending,
      setSaveStatus: vi.fn(), setState, clearUndo: vi.fn(), state: stateRef.current, stateRef
    });
    return null;
  }
  const mount = async () => {
    await act(async () => root.render(<Harness />));
  };
  const advance = async (milliseconds: number) => { await act(async () => vi.advanceTimersByTimeAsync(milliseconds)); };
  const event = async (...events: ManagementStateSubscriptionEvent[]) => {
    await act(async () => { events.forEach((value) => listener?.(value)); await vi.advanceTimersByTimeAsync(0); });
  };
  const visibility = async (nextHidden: boolean) => {
    hidden = nextHidden;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
  };

  it('reads immediately and uses a five-minute full-read watchdog while connected', async () => {
    await mount(); expect(load).toHaveBeenCalledTimes(1);
    await advance(299_999); expect(load).toHaveBeenCalledTimes(1);
    await advance(1); expect(load).toHaveBeenCalledTimes(2);
  });
  it('applies a genuinely newer revision immediately without waiting for a polling slot', async () => {
    await mount(); revision = 2; load.mockResolvedValueOnce(changedRecord());
    await event({ type: 'change', revision });
    expect(load).toHaveBeenCalledTimes(2);
    expect(stateRef.current.staffRequests[0].id).toBe('new'); expect(setState).toHaveBeenCalledTimes(1);
  });
  it('deduplicates initial, repeated, older, and reconnect revision notifications', async () => {
    await mount();
    await event({ type: 'change', revision: 1 }, { type: 'change', revision: 0 });
    await event({ type: 'status', connected: false }, { type: 'status', connected: true }, { type: 'change', revision: 1 });
    await advance(3_000); expect(load).toHaveBeenCalledTimes(1);
  });
  it('does not postpone the five-minute watchdog through healthy stream reconnections', async () => {
    await mount();
    for (let index = 0; index < 6; index += 1) {
      await advance(45_000);
      await event({ type: 'status', connected: false }, { type: 'status', connected: true }, { type: 'change', revision: 1 });
    }
    await advance(29_999); expect(load).toHaveBeenCalledTimes(1);
    await advance(1); expect(load).toHaveBeenCalledTimes(2);
  });
  it('coalesces a burst into one read of the latest revision', async () => {
    await mount(); revision = 4;
    await event({ type: 'change', revision: 2 }, { type: 'change', revision: 3 }, { type: 'change', revision: 4 });
    expect(load).toHaveBeenCalledTimes(2);
    await event({ type: 'change', revision: 3 }, { type: 'change', revision: 4 });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not overlap reads and follows a newer notification received during a load', async () => {
    await mount(); let finish: ((value: PersistedStateRecord) => void) | undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    revision = 2; await event({ type: 'change', revision: 2 }); const older = changedRecord();
    revision = 4; await event({ type: 'change', revision: 3 }, { type: 'change', revision: 4 });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { finish?.(older); await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(3); expect(stateRef.current.staffRequests[0].id).toBe('new');
  });
  it('keeps rendering monotonic authoritative progress while newer notifications continue during every read', async () => {
    await mount();
    const pendingLoads: Array<(value: PersistedStateRecord) => void> = [];
    load.mockImplementation(() => new Promise((resolve) => { pendingLoads.push(resolve); }));
    revision = 2; await event({ type: 'change', revision });
    for (let currentRevision = 2; currentRevision <= 5; currentRevision += 1) {
      revision = currentRevision;
      const response = changedRecord(`revision-${currentRevision}`);
      const finish = pendingLoads.shift();
      if (!finish) throw new Error('Expected one in-flight authoritative read');
      revision = currentRevision + 1;
      await event({ type: 'change', revision });
      await act(async () => { finish(response); await vi.advanceTimersByTimeAsync(0); });
      expect(stateRef.current.staffRequests[0].id).toBe(`revision-${currentRevision}`);
      expect(load).toHaveBeenCalledTimes(currentRevision + 1);
      expect(pendingLoads).toHaveLength(1);
    }
  });
  it('retains a change while a local save is pending without issuing database reads', async () => {
    await mount(); savePending = true; revision = 2; load.mockResolvedValueOnce(changedRecord());
    await event({ type: 'change', revision }); await advance(450); expect(load).toHaveBeenCalledTimes(1);
    savePending = false; await advance(100); expect(load).toHaveBeenCalledTimes(2);
    expect(stateRef.current.staffRequests[0].id).toBe('new');
  });
  it('retains a notified change after a response is discarded for a newer local action', async () => {
    await mount(); let finish: ((value: PersistedStateRecord) => void) | undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    revision = 2; await event({ type: 'change', revision }); const remote = changedRecord();
    savePending = true;
    stateRef.current = { ...stateRef.current, feedback: [{ id: 'local', role: 'Staff', text: 'Keep local', createdAt: '2026-10-28' }] };
    await act(async () => finish?.(remote)); await advance(400);
    expect(load).toHaveBeenCalledTimes(2); expect(setState).not.toHaveBeenCalled();
    load.mockResolvedValueOnce({ ...remote, state: { ...remote.state, feedback: stateRef.current.feedback } });
    savePending = false; await advance(100); expect(load).toHaveBeenCalledTimes(3);
    expect(stateRef.current.staffRequests[0].id).toBe('new'); expect(stateRef.current.feedback[0].id).toBe('local');
  });
  it('retries a notified response invalidated by stateRef even when no save remains pending', async () => {
    await mount(); let finish: ((value: PersistedStateRecord) => void) | undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    revision = 2; await event({ type: 'change', revision }); const remote = changedRecord();
    stateRef.current = { ...stateRef.current, feedback: [{ id: 'local', role: 'Staff', text: 'Keep local', createdAt: '2026-10-28' }] };
    await act(async () => finish?.(remote));
    expect(setState).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledTimes(2);
    load.mockResolvedValueOnce({ ...remote, state: { ...remote.state, feedback: stateRef.current.feedback } });
    await advance(99); expect(load).toHaveBeenCalledTimes(2);
    await advance(1); expect(load).toHaveBeenCalledTimes(3);
    expect(stateRef.current.staffRequests[0].id).toBe('new'); expect(stateRef.current.feedback[0].id).toBe('local');
  });
  it('replaces a stream on credential rotation even when the account and license remain the same', async () => {
    await mount(); const oldListener = listener;
    const access = stateRef.current.settings.pilotAccess!;
    stateRef.current = { ...stateRef.current, settings: { ...stateRef.current.settings, pilotAccess: { ...access, authorizationCode: 'rotated-test-only' } } };
    await mount();
    expect(cleanup).toHaveBeenCalledTimes(1); expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1][0].authorizationCode).toBe('rotated-test-only');
    const calls = load.mock.calls.length;
    await act(async () => { oldListener?.({ type: 'change', revision: 9 }); await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(calls);
  });
  it('replaces a terminated stream after same-key, same-license expiry renewal', async () => {
    await mount(); const oldListener = listener;
    await event({ type: 'status', connected: false });
    const access = stateRef.current.settings.pilotAccess!;
    stateRef.current = { ...stateRef.current, settings: { ...stateRef.current.settings, pilotAccess: { ...access, expiresAt: '2100-01-01' } } };
    await mount();
    expect(cleanup).toHaveBeenCalledTimes(1); expect(subscribe).toHaveBeenCalledTimes(2);
    expect(subscribe.mock.calls[1][0]).toEqual({ ...access, expiresAt: '2100-01-01' });
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => { oldListener?.({ type: 'change', revision: 9 }); await vi.advanceTimersByTimeAsync(0); });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it.each(['unsupported', 'disconnected'] as const)('keeps three-second fallback latency when %s', async (mode) => {
    if (mode === 'unsupported') subscribe.mockReturnValue(undefined);
    await mount(); if (mode === 'disconnected') await event({ type: 'status', connected: false });
    await advance(2_999); expect(load).toHaveBeenCalledTimes(1);
    await advance(1); expect(load).toHaveBeenCalledTimes(2);
  });
  it('closes the stream and pauses reads while hidden, then resubscribes and refreshes promptly', async () => {
    await mount(); const oldListener = listener; await visibility(true); expect(cleanup).toHaveBeenCalledTimes(1);
    await advance(300_000); await act(async () => oldListener?.({ type: 'change', revision: 9 }));
    expect(load).toHaveBeenCalledTimes(1); await visibility(false);
    expect(subscribe).toHaveBeenCalledTimes(2); expect(load).toHaveBeenCalledTimes(2);
  });
  it('does not subscribe or read while initially hidden', async () => {
    hidden = true; await mount(); await advance(300_000);
    expect(load).not.toHaveBeenCalled(); expect(subscribe).not.toHaveBeenCalled();
    await visibility(false); expect(load).toHaveBeenCalledTimes(1); expect(subscribe).toHaveBeenCalledTimes(1);
  });
  it('backs failed reads off to sixty, one hundred twenty, two hundred forty, then three hundred seconds', async () => {
    load.mockRejectedValue(new Error('isolated quota failure')); await mount(); expect(load).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
      await advance(delay - 1); expect(load).toHaveBeenCalledTimes(index + 1);
      await advance(1); expect(load).toHaveBeenCalledTimes(index + 2);
    }
  });
  it.each(['missing', 'unavailable', 'offline-cache', 'unknown-revision', 'unknown-authority', 'stale-revision'] as const)('backs off an unusable %s stream-triggered response without applying it', async (result) => {
    await mount(); revision = 2; const remote = changedRecord();
    load.mockResolvedValueOnce(result === 'missing' ? null : result === 'unavailable' ? undefined : {
      ...remote, authoritative: result === 'offline-cache' ? false : result === 'unknown-authority' ? undefined : true,
      revision: result === 'unknown-revision' ? undefined : result === 'stale-revision' ? 1 : 2
    });
    await event({ type: 'change', revision }); expect(setState).not.toHaveBeenCalled();
    await advance(59_999); expect(load).toHaveBeenCalledTimes(2);
    await advance(1); expect(load).toHaveBeenCalledTimes(3);
  });
  it('does not bypass a failed-read deadline through notifications, reconnection, or visibility changes', async () => {
    load.mockRejectedValue(new Error('isolated quota failure')); await mount(); await advance(10_000);
    await event({ type: 'change', revision: 3 }); await visibility(true); await advance(10_000); await visibility(false);
    await event({ type: 'status', connected: true }, { type: 'change', revision: 4 });
    await advance(39_999); expect(load).toHaveBeenCalledTimes(1);
    await advance(1); expect(load).toHaveBeenCalledTimes(2);
  });
  it('restores the connected idle watchdog after a failed read succeeds', async () => {
    load.mockRejectedValueOnce(new Error('isolated quota failure')); await mount(); await advance(60_000);
    expect(load).toHaveBeenCalledTimes(2); await advance(299_999); expect(load).toHaveBeenCalledTimes(2);
    await advance(1); expect(load).toHaveBeenCalledTimes(3);
  });
  it('ignores malformed and unsafe revision notifications', async () => {
    await mount(); await event({ type: 'change', revision: -1 }, { type: 'change', revision: 1.5 }, { type: 'change', revision: Number.MAX_SAFE_INTEGER + 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('cleans up the stream, timers, and visibility listener when unmounted', async () => {
    await mount(); const oldListener = listener; await act(async () => root.unmount()); expect(cleanup).toHaveBeenCalledTimes(1);
    await act(async () => oldListener?.({ type: 'change', revision: 2 }));
    await visibility(true); await visibility(false); await advance(600_000);
    expect(load).toHaveBeenCalledTimes(1); expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
