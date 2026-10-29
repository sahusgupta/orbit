import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { createManagementStateEvents, createManagementStateSubscriptions, createStateEventParser } = require('./managementStateEvents.cjs');
const encode = (text) => new TextEncoder().encode(text);
const frame = (event, data = {}) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
async function flush() { for (let index = 0; index < 10; index += 1) await Promise.resolve(); }
function stream() {
  let controller;
  const cancel = vi.fn();
  const body = new ReadableStream({ start(value) { controller = value; }, cancel });
  return {
    response: new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8' } }),
    push: (text) => controller.enqueue(typeof text === 'string' ? encode(text) : text),
    close: () => controller.close(), cancel
  };
}

describe('management revision SSE parser', () => {
  it('handles split CRLF, comments, repeated data lines, and complete frames only', () => {
    const events = [];
    const parser = createStateEventParser((event, data) => events.push([event, data]));
    const wire = ': keepalive\r\nevent: change\r\ndata: {\r\ndata: "revision":7}\r\n\r\nevent: change\ndata: {"revision":8}';
    for (const character of wire) parser.push(character);
    expect(events).toEqual([['change', '{\n"revision":7}']]);
    parser.push('\n\n');
    expect(events.at(-1)).toEqual(['change', '{"revision":8}']);
  });

  it('bounds whole frames, including comments and individually short data lines', () => {
    expect(() => createStateEventParser(() => {}).push(`:${'x'.repeat(8192)}`)).toThrow('limit');
    const parser = createStateEventParser(() => {});
    expect(() => parser.push(`data: ${'x'.repeat(4100)}\ndata: ${'x'.repeat(4100)}\n\n`)).toThrow('limit');
  });
});

describe('management revision notification transport', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it('projects revision-only hints, preserves UTF-8 chunk boundaries, and ignores unknown events', async () => {
    const source = stream();
    const connect = vi.fn().mockResolvedValue(source.response);
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent, random: () => 0.5 });
    await flush();
    const bytes = encode(frame('ready') + frame('change', { revision: 7, privateData: 'café-private' }) + frame('heartbeat') + frame('unrecognized', { customer: 'never-forward' }));
    for (const byte of bytes) source.push(Uint8Array.of(byte));
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(onEvent.mock.calls.map(([event]) => event)).toEqual([
      { type: 'status', connected: false }, { type: 'status', connected: true }, { type: 'change', revision: 7 }
    ]);
    expect(JSON.stringify(onEvent.mock.calls)).not.toMatch(/private|customer|never-forward/);
    stop();
    await flush();
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][0].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reconnects after EOF and emits the initial revision again to recover missed notifications', async () => {
    const first = stream(); const second = stream();
    const connect = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent, random: () => 0.5 });
    await flush(); first.push(frame('ready') + frame('change', { revision: 9 })); await flush();
    first.close(); await flush();
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', connected: false });
    await vi.advanceTimersByTimeAsync(999); expect(connect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); second.push(frame('ready') + frame('change', { revision: 9 })); await flush();
    expect(onEvent.mock.calls.filter(([event]) => event.type === 'change')).toEqual([
      [{ type: 'change', revision: 9 }], [{ type: 'change', revision: 9 }]
    ]);
    stop(); await flush();
  });

  it('backs off failed attempts to a bounded delay and resets after a valid initial snapshot', async () => {
    const healthy = stream();
    const connect = vi.fn().mockRejectedValue(new Error('test-only unavailable'));
    const stop = createManagementStateEvents({ connect, onEvent: vi.fn(), random: () => 0.5 });
    await flush();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const count = connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1); expect(connect).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1); expect(connect).toHaveBeenCalledTimes(count + 1);
    }
    connect.mockResolvedValueOnce(healthy.response);
    await vi.advanceTimersByTimeAsync(30000); healthy.push(frame('ready') + frame('change', { revision: 0 })); await flush(); healthy.close(); await flush();
    const count = connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000); expect(connect).toHaveBeenCalledTimes(count + 1);
    stop(); await flush();
  });

  it('keeps a healthy heartbeat alive and aborts a silent stream before reconnecting', async () => {
    const source = stream();
    const connect = vi.fn().mockResolvedValue(source.response);
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent, random: () => 0.5 });
    await flush(); source.push(frame('ready') + frame('change', { revision: 0 })); await flush();
    await vi.advanceTimersByTimeAsync(15000); source.push(frame('heartbeat')); await flush();
    await vi.advanceTimersByTimeAsync(24999); expect(source.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(source.cancel).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', connected: false });
    stop(); await flush();
  });

  it('accumulates bounded backoff when readiness is followed by EOF without an initial header', async () => {
    const connect = vi.fn(async () => new Response(frame('ready'), { headers: { 'content-type': 'text/event-stream' } }));
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent, random: () => 0.5 });
    await flush();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      const count = connect.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1); expect(connect).toHaveBeenCalledTimes(count);
      await vi.advanceTimersByTimeAsync(1); expect(connect).toHaveBeenCalledTimes(count + 1);
    }
    expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]);
    stop(); await flush();
  });

  it('keeps the initial ten-second header deadline despite readiness and repeated heartbeats', async () => {
    const source = stream(); const onEvent = vi.fn();
    const connect = vi.fn().mockResolvedValue(source.response);
    const stop = createManagementStateEvents({ connect, onEvent, random: () => 0.5 });
    await flush(); source.push(frame('ready')); await flush();
    for (let count = 0; count < 4; count += 1) {
      await vi.advanceTimersByTimeAsync(2000); source.push(frame('heartbeat')); await flush();
    }
    await vi.advanceTimersByTimeAsync(1999); expect(source.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(source.cancel).toHaveBeenCalledOnce();
    expect(connect.mock.calls[0][0].signal.aborted).toBe(true);
    expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]);
    stop(); await flush();
  });

  it('bounds pending connection setup and periodically renews even a continuously active stream', async () => {
    let pendingSignal;
    const pending = createManagementStateEvents({ connect: ({ signal }) => {
      pendingSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('test abort')), { once: true }));
    }, onEvent: vi.fn() });
    await vi.advanceTimersByTimeAsync(9999); expect(pendingSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(pendingSignal.aborted).toBe(true); pending();
    const source = stream(); const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect: async () => source.response, onEvent });
    await flush(); source.push(frame('ready') + frame('change', { revision: 0 })); await flush();
    for (let count = 0; count < 3; count += 1) {
      await vi.advanceTimersByTimeAsync(15000); source.push(frame('heartbeat')); await flush();
    }
    await vi.advanceTimersByTimeAsync(14999); expect(source.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(source.cancel).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', connected: false });
    stop(); await flush();
  });

  it.each([401, 403])('stops retrying rejected credentials (%s) without forwarding error bodies', async (status) => {
    const connect = vi.fn().mockResolvedValue(new Response('test-only auth detail', { status }));
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent });
    await flush(); await vi.advanceTimersByTimeAsync(120000);
    expect(connect).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]);
    stop();
  });

  it.each([
    frame('change', { revision: 1 }),
    frame('ready') + frame('change', { revision: -1 }),
    frame('ready') + frame('change', { revision: 1.5 }),
    frame('ready') + frame('change', { revision: Number.MAX_SAFE_INTEGER + 1 }),
    frame('ready') + frame('change', { revision: '3' }),
    frame('ready') + 'event: change\ndata: invalid-json\n\n',
    frame('ready') + frame('ready'),
    frame('ready', { privateData: 'not-ready' })
  ])('rejects malformed protocol data without exposing its contents', async (wire) => {
    const source = stream(); const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect: async () => source.response, onEvent });
    await flush(); source.push(wire); await flush();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'change')).toBe(false);
    expect(onEvent).toHaveBeenLastCalledWith({ type: 'status', connected: false });
    expect(source.cancel).toHaveBeenCalledOnce();
    stop();
  });

  it('cancels pending setup and ignores a late response after synchronous cleanup', async () => {
    const source = stream(); let resolve;
    const connect = vi.fn(() => new Promise((done) => { resolve = done; }));
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect, onEvent });
    stop(); stop(); resolve(source.response); await flush();
    expect(connect.mock.calls[0][0].signal.aborted).toBe(true);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects oversized chunks, invalid UTF-8, and non-SSE responses', async () => {
    for (const value of [new Uint8Array(65537), Uint8Array.of(0xff)]) {
      const source = stream(); const onEvent = vi.fn();
      const stop = createManagementStateEvents({ connect: async () => source.response, onEvent });
      await flush(); source.push(value); await flush();
      expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]);
      expect(source.cancel).toHaveBeenCalledOnce(); stop();
    }
    const onEvent = vi.fn();
    const stop = createManagementStateEvents({ connect: async () => new Response('{"revision":7}'), onEvent });
    await flush(); expect(onEvent.mock.calls).toEqual([[{ type: 'status', connected: false }]]); stop();
  });
});

function webContents() {
  const sender = new EventEmitter();
  sender.send = vi.fn(); sender.isDestroyed = () => false;
  return sender;
}
describe('main-process management subscription ownership', () => {
  it('keeps one subscription per window, projects safe payloads, and ignores stale cleanup/events', () => {
    const stops = []; const callbacks = [];
    const subscribe = vi.fn((_access, callback) => { callbacks.push(callback); const stop = vi.fn(); stops.push(stop); return stop; });
    const registry = createManagementStateSubscriptions({ subscribe }); const sender = webContents();
    registry.subscribe(sender, 'first', { licenseId: 'club-one' });
    registry.subscribe(sender, 'second', { licenseId: 'club-two' });
    expect(stops[0]).toHaveBeenCalledOnce(); registry.unsubscribe(sender, 'first'); expect(stops[1]).not.toHaveBeenCalled();
    callbacks[0]({ type: 'change', revision: 3 });
    callbacks[1]({ type: 'change', revision: -1 });
    callbacks[1]({ type: 'change', revision: 4, privateData: 'discarded' });
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('management-state-event', 'second', { type: 'change', revision: 4 });
    registry.unsubscribe(sender, 'second'); registry.unsubscribe(sender, 'second'); expect(stops[1]).toHaveBeenCalledOnce();
    expect(sender.eventNames()).toEqual([]);
  });

  it.each(['destroyed', 'render-process-gone', 'did-start-navigation'])('cleans streams and hooks on %s', (name) => {
    const stop = vi.fn(); const registry = createManagementStateSubscriptions({ subscribe: () => stop }); const sender = webContents();
    registry.subscribe(sender, 'one', { licenseId: 'club-one' });
    sender.emit('did-start-navigation', {}, 'https://example.test', false, false); expect(stop).not.toHaveBeenCalled();
    sender.emit('did-start-navigation', {}, 'http://127.0.0.1/#/table', true, true); expect(stop).not.toHaveBeenCalled();
    sender.emit(name, {}, 'http://127.0.0.1/', false, true); expect(stop).toHaveBeenCalledOnce();
    expect(sender.eventNames()).toEqual([]); registry.stop(); expect(stop).toHaveBeenCalledOnce();
  });

  it('isolates windows, rejects channel-like IDs, and stops every stream on app shutdown', () => {
    const stops = []; const subscribe = vi.fn(() => { const stop = vi.fn(); stops.push(stop); return stop; });
    const registry = createManagementStateSubscriptions({ subscribe }); const first = webContents(); const second = webContents();
    for (const value of ['', 'arbitrary:channel', 'x'.repeat(81), {}, 1]) expect(() => registry.subscribe(first, value, {})).toThrow('ID');
    expect(subscribe).not.toHaveBeenCalled();
    registry.subscribe(first, 'one', {}); registry.subscribe(second, 'two', {}); registry.stop();
    expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(first.eventNames()).toEqual([]); expect(second.eventNames()).toEqual([]);
  });

  it('cleans hooks if subscription setup fails or synchronously destroys its owner', () => {
    const sender = webContents();
    const failing = createManagementStateSubscriptions({ subscribe() { throw new Error('test failure'); } });
    expect(() => failing.subscribe(sender, 'one', {})).toThrow(); expect(sender.eventNames()).toEqual([]);
    const stop = vi.fn();
    const synchronous = createManagementStateSubscriptions({ subscribe() { sender.emit('destroyed'); return stop; } });
    synchronous.subscribe(sender, 'two', {}); expect(stop).toHaveBeenCalledOnce(); expect(sender.eventNames()).toEqual([]);
  });
});
