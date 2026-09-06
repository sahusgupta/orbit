import { describe, expect, it, vi } from 'vitest';
import { playerServiceHosts, withBlockedPlayerHosts } from './player-simulator-network.mjs';

function fixture() {
  const original = '127.0.0.1 localhost\n::1 localhost\n';
  let contents = original;
  const operations = {
    readHosts: () => contents,
    writeHosts: vi.fn((next) => { contents = next; }),
    flushDns: vi.fn(),
    resolveHost: vi.fn(async () => [{ address: '127.0.0.1' }, { address: '::1' }])
  };
  return { operations, original, contents: () => contents };
}

describe('disposable simulator production-host isolation', () => {
  it('blocks every service before launching and restores the exact original file', async () => {
    const state = fixture();
    const task = vi.fn(() => {
      expect(state.operations.resolveHost).toHaveBeenCalledTimes(playerServiceHosts.length);
      for (const host of playerServiceHosts) {
        expect(state.contents()).toContain(`127.0.0.1 ${host}\n::1 ${host}`);
      }
    });
    await withBlockedPlayerHosts(state.operations, task);
    expect(task).toHaveBeenCalledOnce();
    expect(state.contents()).toBe(state.original);
    expect(state.operations.flushDns).toHaveBeenCalledTimes(2);
  });

  it.each([
    { addresses: [] },
    { addresses: [{ address: '203.0.113.7' }] },
    { addresses: [{ address: '::1' }, { address: '2001:db8::7' }] }
  ])(
    'never launches when resolution is absent or includes an external address: $addresses', async ({ addresses }) => {
      const state = fixture();
      state.operations.resolveHost.mockResolvedValue(addresses);
      const task = vi.fn();
      await expect(withBlockedPlayerHosts(state.operations, task)).rejects.toThrow('resolve only to loopback');
      expect(task).not.toHaveBeenCalled();
      expect(state.contents()).toBe(state.original);
    }
  );

  it('restores networking when the app flow fails', async () => {
    const state = fixture();
    await expect(withBlockedPlayerHosts(state.operations, () => { throw new Error('flow failed'); }))
      .rejects.toThrow('flow failed');
    expect(state.contents()).toBe(state.original);
  });

  it('restores networking when DNS cache flushing fails', async () => {
    const state = fixture();
    state.operations.flushDns.mockImplementationOnce(() => { throw new Error('flush failed'); });
    const task = vi.fn();
    await expect(withBlockedPlayerHosts(state.operations, task)).rejects.toThrow('flush failed');
    expect(task).not.toHaveBeenCalled();
    expect(state.contents()).toBe(state.original);
  });

  it('rejects an existing service override without editing the host file', async () => {
    const state = fixture();
    state.operations.readHosts = () => `203.0.113.7 ${playerServiceHosts[0]}\n`;
    await expect(withBlockedPlayerHosts(state.operations, vi.fn())).rejects.toThrow('already overrides');
    expect(state.operations.writeHosts).not.toHaveBeenCalled();
  });
});
