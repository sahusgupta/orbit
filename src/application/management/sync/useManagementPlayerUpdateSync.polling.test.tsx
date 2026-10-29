// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState, PersistedStateRecord } from '../../../domain/types';
import * as persistence from '../../../app/persistence/managementPersistence';
import { useManagementPlayerUpdateSync } from './useManagementPlayerUpdateSync';

vi.mock('../../../app/persistence/managementPersistence', () => ({
  hasManagementDesktopPersistence: vi.fn(),
  loadDesktopManagementStateForAccount: vi.fn(),
  loadManagementStateFromLocalBridge: vi.fn(),
  publishStateToLocalOrbitBridge: vi.fn()
}));

describe('desktop authoritative poll scheduling', () => {
  let root: Root;
  let container: HTMLDivElement;
  let stateRef: { current: AppState };
  let savePending: boolean;
  let hidden: boolean;
  const load = vi.mocked(persistence.loadDesktopManagementStateForAccount);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
    savePending = false;
    hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    stateRef = { current: structuredClone(seedState) };
    stateRef.current.settings.pilotAccess = {
      authorized: true, licenseId: 'poll-test', authorizationCode: 'test-only',
      activatedAt: '2026-10-28', expiresAt: '2099-12-31'
    };
    vi.mocked(persistence.hasManagementDesktopPersistence).mockReturnValue(true);
    load.mockImplementation(async () => record());
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const record = (): PersistedStateRecord => ({
    state: structuredClone(stateRef.current), authoritative: true,
    schemaVersion: 5, savedAt: '2026-10-28T12:00:00.000Z'
  });

  const mount = async () => {
    function Harness() {
      useManagementPlayerUpdateSync({
        activeAccountKey: 'poll-test', hasAuthenticated: true,
        announceIncomingPlayerRequest: vi.fn(), isManagementSavePending: () => savePending,
        setSaveStatus: vi.fn(), setState: vi.fn(), clearUndo: vi.fn(),
        state: stateRef.current, stateRef
      });
      return null;
    }
    await act(async () => root.render(<Harness />));
  };

  const advance = async (milliseconds: number) => {
    await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
  };
  const visibility = async (nextHidden: boolean) => {
    hidden = nextHidden;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  it('reads immediately, then waits thirty seconds between healthy foreground reads', async () => {
    await mount();
    expect(load).toHaveBeenCalledTimes(1);
    await advance(29_999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('waits thirty seconds after a slow read completes without overlapping requests', async () => {
    let finish: ((value: PersistedStateRecord) => void) | undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await mount();
    await advance(90_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => finish?.(record()));
    await advance(29_999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not start hidden and pauses scheduled reads until visible again', async () => {
    hidden = true;
    await mount();
    await advance(300_000);
    expect(load).not.toHaveBeenCalled();
    await visibility(false);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(10_000);
    await visibility(true);
    await advance(300_000);
    expect(load).toHaveBeenCalledTimes(1);
    await visibility(false);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(30_000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('keeps the healthy deadline when visibility changes before the next read is due', async () => {
    await mount();
    await advance(10_000);
    await visibility(true);
    await advance(10_000);
    await visibility(false);
    await advance(9_999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('backs failures off to sixty, one hundred twenty, two hundred forty, then three hundred seconds', async () => {
    load.mockRejectedValue(new Error('isolated quota failure'));
    await mount();
    expect(load).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
      await advance(delay - 1);
      expect(load).toHaveBeenCalledTimes(index + 1);
      await advance(1);
      expect(load).toHaveBeenCalledTimes(index + 2);
    }
  });

  it.each(['missing', 'unavailable', 'offline-cache'] as const)('backs off a %s response instead of treating it as a healthy read', async (result) => {
    load.mockResolvedValueOnce(result === 'missing' ? null : result === 'unavailable' ? undefined : { ...record(), authoritative: false });
    await mount();
    await advance(59_999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not bypass a failure deadline through repeated visibility changes', async () => {
    load.mockRejectedValue(new Error('isolated quota failure'));
    await mount();
    await advance(10_000);
    await visibility(true);
    await advance(10_000);
    await visibility(false);
    await visibility(false);
    await advance(39_999);
    expect(load).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('resumes thirty-second polling after an authoritative read succeeds', async () => {
    load.mockRejectedValueOnce(new Error('isolated quota failure'));
    await mount();
    await advance(60_000);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(29_999);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('waits for the next normal slot when an account save blocks a due read', async () => {
    savePending = true;
    await mount();
    await advance(10_000);
    savePending = false;
    await advance(19_999);
    expect(load).not.toHaveBeenCalled();
    await advance(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cleans up timers and visibility listeners when unmounted', async () => {
    await mount();
    await act(async () => root.unmount());
    await visibility(true);
    await visibility(false);
    await advance(600_000);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
