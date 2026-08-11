import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import liveUpdatesModule from './liveUpdates.js';

const { createLiveUpdates } = liveUpdatesModule;

function connection(lastEventId = '') {
  const request = Object.assign(new EventEmitter(), {
    get: vi.fn((name) => name === 'last-event-id' ? lastEventId : '')
  });
  const writes = [];
  const response = {
    end: vi.fn(),
    json: vi.fn(),
    set: vi.fn(),
    status: vi.fn(function status() { return this; }),
    write: vi.fn((value) => {
      writes.push(value);
      return true;
    }),
    writeHead: vi.fn()
  };
  return { request, response, writes };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('dashboard live update recovery', () => {
  it('assigns replay IDs, resumes from Last-Event-ID, heartbeats, and closes bounded sessions', () => {
    vi.useFakeTimers();
    const updates = createLiveUpdates();
    const first = connection();
    updates.connect(first.request, first.response, 'started');

    expect(updates.broadcast('client', { id: 'one' })).toBe(1);
    expect(updates.broadcast('telemetry', { id: 'two' })).toBe(2);
    expect(first.writes.join('')).toContain('id: 2\nevent: telemetry');

    const resumed = connection('1');
    updates.connect(resumed.request, resumed.response, 'started');
    expect(resumed.writes.join('')).toContain('id: 2\nevent: telemetry');
    expect(resumed.writes.join('')).not.toContain('id: 1\nevent: client');

    vi.advanceTimersByTime(20_000);
    expect(resumed.writes).toContain(': heartbeat\n\n');
    vi.advanceTimersByTime(15 * 60_000);
    expect(resumed.response.end).toHaveBeenCalled();
    expect(updates.getConnectionCount()).toBe(0);
    first.request.emit('close');
    resumed.request.emit('close');
    expect(updates.getConnectionCount()).toBe(0);
  });

  it('signals a durable reload when a reconnect cursor is outside the in-memory replay window', () => {
    const updates = createLiveUpdates();
    updates.broadcast('client', { id: 'one' });
    const resumed = connection('99');
    updates.connect(resumed.request, resumed.response, 'started');
    expect(resumed.writes.join('')).toContain('event: replay-reset');
    resumed.request.emit('close');
  });

  it('disconnects a client that applies backpressure', () => {
    const updates = createLiveUpdates();
    const slow = connection();
    updates.connect(slow.request, slow.response, 'started');
    slow.response.write.mockReturnValueOnce(false);
    updates.broadcast('client', { id: 'one' });
    expect(slow.response.end).toHaveBeenCalled();
    expect(updates.getConnectionCount()).toBe(0);
  });

  it('rejects connections above the configured capacity', () => {
    vi.stubEnv('ORBIT_SSE_MAX_CONNECTIONS', '1');
    const updates = createLiveUpdates();
    const first = connection();
    const second = connection();
    updates.connect(first.request, first.response, 'started');
    updates.connect(second.request, second.response, 'started');
    expect(second.response.status).toHaveBeenCalledWith(503);
    expect(second.response.json).toHaveBeenCalledWith({ ok: false, error: 'Live update capacity reached.' });
    first.request.emit('close');
  });
});
