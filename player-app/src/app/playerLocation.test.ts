import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerLocation, playerLocationTimeoutMs } from './playerLocation';

const expo = vi.hoisted(() => ({ permission: vi.fn(), position: vi.fn() }));
vi.mock('expo-location', () => ({ requestForegroundPermissionsAsync: expo.permission, getCurrentPositionAsync: expo.position, Accuracy: { Balanced: 3 } }));

describe('Explicit one-shot foreground location port', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); expo.permission.mockResolvedValue({ granted: true }); expo.position.mockResolvedValue({ coords: { latitude: 30, longitude: -97 }, timestamp: Date.now() }); });
  afterEach(() => vi.useRealTimers());
  it('uses foreground permission and balanced accuracy only on an explicit call', async () => {
    expect(expo.permission).not.toHaveBeenCalled();
    await expect(playerLocation.getOneShotPosition()).resolves.toMatchObject({ coordinate: { latitude: 30, longitude: -97 } });
    expect(expo.permission).toHaveBeenCalledOnce();
    expect(expo.position).toHaveBeenCalledExactlyOnceWith({ accuracy: 3 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not read device position after permission denial', async () => {
    expo.permission.mockResolvedValue({ granted: false });
    await expect(playerLocation.getOneShotPosition()).rejects.toThrow('Choose a point manually');
    expect(expo.position).not.toHaveBeenCalled();
  });
  it('bounds an unresolved fix without returning late results', async () => {
    expo.position.mockReturnValue(new Promise(() => undefined));
    const pending = expect(playerLocation.getOneShotPosition()).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(playerLocationTimeoutMs);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start a device read after a late permission reply to an expired request', async () => {
    let grant!: (value: { granted: boolean }) => void;
    expo.permission.mockReturnValue(new Promise((resolve) => { grant = resolve; }));
    const pending = expect(playerLocation.getOneShotPosition()).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(playerLocationTimeoutMs);
    await pending;
    grant({ granted: true });
    await Promise.resolve(); await Promise.resolve();
    expect(expo.position).not.toHaveBeenCalled();
  });
  it.each([{ latitude: 91, longitude: 0 }, { latitude: 0, longitude: NaN }])('rejects malformed device coordinates', async (coords) => {
    expo.position.mockResolvedValue({ coords, timestamp: Date.now() });
    await expect(playerLocation.getOneShotPosition()).rejects.toThrow('current location');
  });
  it('rejects a stale cached device fix', async () => {
    expo.position.mockResolvedValue({ coords: { latitude: 30, longitude: -97 }, timestamp: Date.now() - 121_000 });
    await expect(playerLocation.getOneShotPosition()).rejects.toThrow('current location');
  });
});
