/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceOriginLifetimeMs } from '../domain/playerLocation';
import { usePlayerLocation } from './usePlayerLocation';

const boundary = vi.hoisted(() => ({ position: vi.fn(), load: vi.fn(), save: vi.fn(), clear: vi.fn() }));
vi.mock('../app/playerLocation', () => ({ playerLocation: { getOneShotPosition: boundary.position } }));
vi.mock('../data/storage/playerStorage', () => ({ playerStorage: { loadLocalOrigin: boundary.load, saveLocalOrigin: boundary.save, clearLocalOrigin: boundary.clear } }));
const nowMs = Date.parse('2026-10-12T12:00:00.000Z');
const coordinate = { latitude: 30, longitude: -97 };

describe('Device-local optional search origin', () => {
  let root: Root;
  let container: HTMLDivElement;
  let mounted: boolean;
  let options: Parameters<typeof usePlayerLocation>[0];
  let result: ReturnType<typeof usePlayerLocation> | undefined;
  function Harness() { result = usePlayerLocation(options); return null; }
  const current = () => { if (!result) throw new Error('Location hook did not mount'); return result; };
  const render = async () => {
    await act(async () => { root.render(<Harness />); mounted = true; });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  };
  const unmount = () => { if (mounted) act(() => root.unmount()); mounted = false; };
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.useFakeTimers(); vi.setSystemTime(nowMs); vi.clearAllMocks();
    boundary.load.mockResolvedValue(null); boundary.save.mockResolvedValue(undefined); boundary.clear.mockResolvedValue(undefined);
    boundary.position.mockResolvedValue({ coordinate, capturedAt: nowMs });
    options = { owner: 'account:one', demoMode: false };
    mounted = false; result = undefined;
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { unmount(); container.remove(); vi.useRealTimers(); });

  it('restores only owner-local data without requesting permission on mount', async () => {
    boundary.load.mockResolvedValue({ coordinate, label: 'Selected map location', source: 'manual', capturedAt: nowMs - 86_400_000, expiresAt: null });
    await render();
    expect(current()).toMatchObject({ origin: coordinate, source: 'manual', ready: true });
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith('account:one');
    expect(boundary.position).not.toHaveBeenCalled();
  });
  it('stores a chosen manual point after a secure write and supports clearing it', async () => {
    await render();
    await act(async () => { await expect(current().selectManual(coordinate)).resolves.toBe(true); });
    expect(current().origin).toEqual(coordinate);
    expect(boundary.save).toHaveBeenCalledWith('account:one', { coordinate, label: 'Selected map location', source: 'manual', capturedAt: nowMs, expiresAt: null });
    await act(async () => { await current().clear(); });
    expect(current().origin).toBeNull();
    expect(boundary.clear).toHaveBeenCalledWith('account:one');
  });
  it('refuses invalid coordinates and does not optimistically retain failed secure writes', async () => {
    await render();
    await act(async () => { await expect(current().selectManual({ latitude: 91, longitude: 0 })).resolves.toBe(false); });
    expect(boundary.save).not.toHaveBeenCalled();
    boundary.save.mockRejectedValueOnce(new Error('Secure storage failed'));
    await act(async () => { await expect(current().selectManual(coordinate)).resolves.toBe(false); });
    expect(current().origin).toBeNull();
    expect(current().error).toContain('saved securely');
  });
  it('waits for secure storage before publishing a manual search origin', async () => {
    let persist!: () => void;
    boundary.save.mockReturnValue(new Promise<void>((resolve) => { persist = resolve; }));
    await render();
    let pending!: Promise<boolean>;
    act(() => { pending = current().selectManual(coordinate); });
    expect(current()).toMatchObject({ origin: null, busy: true });
    await act(async () => { persist(); await expect(pending).resolves.toBe(true); });
    expect(current()).toMatchObject({ origin: coordinate, busy: false });
  });
  it('requests a device fix only explicitly and expires it after fifteen minutes', async () => {
    await render();
    await act(async () => { await expect(current().useDevice()).resolves.toBe(true); });
    expect(boundary.position).toHaveBeenCalledOnce();
    expect(current()).toMatchObject({ origin: coordinate, source: 'device' });
    await act(async () => { await vi.advanceTimersByTimeAsync(deviceOriginLifetimeMs); });
    expect(current().origin).toBeNull();
    expect(current().error).toContain('expired');
    expect(boundary.clear).toHaveBeenCalledWith('account:one', nowMs);
  });
  it('clears an expired stored fix without ever using it as a search origin', async () => {
    boundary.load.mockResolvedValue({ coordinate, label: 'Device location', source: 'device', capturedAt: nowMs - deviceOriginLifetimeMs, expiresAt: nowMs });
    await render();
    expect(current().origin).toBeNull();
    expect(boundary.clear).toHaveBeenCalledWith('account:one', nowMs - deviceOriginLifetimeMs);
    expect(boundary.position).not.toHaveBeenCalled();
  });
  it('removes the device expiry timer on unmount without clearing the retained local point', async () => {
    await render();
    await act(async () => { await current().useDevice(); });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(boundary.clear).not.toHaveBeenCalled();
  });
  it('coalesces rapid device actions into one request', async () => {
    let resolve!: (value: { coordinate: typeof coordinate; capturedAt: number }) => void;
    boundary.position.mockReturnValue(new Promise((next) => { resolve = next; }));
    await render();
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = current().useDevice();
      await expect(current().useDevice()).resolves.toBe(false);
    });
    expect(boundary.position).toHaveBeenCalledOnce();
    await act(async () => { resolve({ coordinate, capturedAt: nowMs }); await expect(pending).resolves.toBe(true); });
    expect(boundary.save).toHaveBeenCalledOnce();
  });
  it('keeps manual selection usable after permission denial', async () => {
    await render();
    boundary.position.mockRejectedValueOnce(new Error('Permission denied. Choose a point manually.'));
    await act(async () => { await expect(current().useDevice()).resolves.toBe(false); });
    expect(current().error).toContain('Permission denied');
    await act(async () => { await expect(current().selectManual(coordinate)).resolves.toBe(true); });
    expect(current()).toMatchObject({ origin: coordinate, source: 'manual', error: '' });
  });
  it('retires an outstanding device result after switching owners', async () => {
    let resolve!: (value: { coordinate: typeof coordinate; capturedAt: number }) => void;
    boundary.position.mockReturnValue(new Promise((next) => { resolve = next; }));
    await render();
    let pending!: Promise<boolean>;
    act(() => { pending = current().useDevice(); });
    options = { ...options, owner: 'account:two' };
    await render();
    await act(async () => { resolve({ coordinate, capturedAt: nowMs }); await expect(pending).resolves.toBe(false); });
    expect(current().origin).toBeNull();
    expect(boundary.save).not.toHaveBeenCalled();
  });
  it('retires late device replies on unmount and does not install background watchers', async () => {
    let resolve!: (value: { coordinate: typeof coordinate; capturedAt: number }) => void;
    boundary.position.mockReturnValue(new Promise((next) => { resolve = next; }));
    await render();
    let pending!: Promise<boolean>;
    act(() => { pending = current().useDevice(); });
    unmount();
    resolve({ coordinate, capturedAt: nowMs });
    await expect(pending).resolves.toBe(false);
    expect(boundary.save).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps demo origins in memory and never calls the device location API', async () => {
    options = { ...options, demoMode: true };
    await render();
    await act(async () => { await expect(current().useDevice()).resolves.toBe(false); await current().selectManual(coordinate); });
    expect(current().origin).toEqual(coordinate);
    expect(boundary.position).not.toHaveBeenCalled(); expect(boundary.load).not.toHaveBeenCalled(); expect(boundary.save).not.toHaveBeenCalled();
  });
  it('does not start permission or clear operations from an unmounted controller', async () => {
    await render();
    const retired = current();
    unmount();
    await expect(retired.useDevice()).resolves.toBe(false);
    await expect(retired.clear()).resolves.toBe(false);
    expect(boundary.position).not.toHaveBeenCalled(); expect(boundary.clear).not.toHaveBeenCalled();
  });
  it('does not start permission or clear operations from a captured previous owner', async () => {
    await render();
    const retired = current();
    options = { ...options, owner: 'device:two' };
    await render();
    await expect(retired.useDevice()).resolves.toBe(false);
    await expect(retired.clear()).resolves.toBe(false);
    expect(boundary.position).not.toHaveBeenCalled(); expect(boundary.clear).not.toHaveBeenCalled();
    expect(current().origin).toBeNull();
  });
  it('does not clear or request GPS before a pending local restore is ready', async () => {
    let restore!: (value: unknown) => void;
    boundary.load.mockReturnValue(new Promise((resolve) => { restore = resolve; }));
    await render();
    await expect(current().clear()).resolves.toBe(false);
    await expect(current().useDevice()).resolves.toBe(false);
    expect(boundary.clear).not.toHaveBeenCalled(); expect(boundary.position).not.toHaveBeenCalled();
    await act(async () => { restore({ coordinate, label: 'Manual point', source: 'manual', capturedAt: nowMs, expiresAt: null }); await Promise.resolve(); });
    expect(current().origin).toEqual(coordinate);
  });
});
