import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(__filename);
const sourcePath = require.resolve('./firebasePublisher.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const RootResponse = Response;
const RootReadableStream = ReadableStream;
const budget = 30_000;
const projectId = 'demo-orbit-native-body';
const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`;
const diagnosticPath = 'synthetic-body-reader-path';
const token = 'inert-native-body-fixture-token';
const protectedIdentifier = value => crypto.createHmac('sha256', 'synthetic-native-body-log-hash-secret-only')
  .update(String(value)).digest('hex').slice(0, 16);

/** @typedef {{ ok: boolean, status: number, json: () => Promise<unknown>, text: () => Promise<string> }} ConsumedResponse */
/** @typedef {(response: ConsumedResponse) => Promise<unknown>} ConsumeResponse */
/** @typedef {{ state: 'pending' | 'fulfilled' | 'rejected', value: unknown, error: unknown, observed: Promise<void> }} Outcome */
/** @typedef {{ method?: string, headers?: Record<string, string>, body?: string, signal?: AbortSignal }} FixtureInit */
/** @typedef {{ kind: 'json' | 'text', label: string, chunks: Uint8Array[], expected: unknown }} DecodingCase */
/** @type {Array<() => Promise<void>>} */
const fixtureCleanups = [];

async function flush() {
  for (let index = 0; index < 128; index += 1) await Promise.resolve();
}

/** @param {Promise<unknown>} promise @returns {Outcome} */
function observe(promise) {
  /** @type {Outcome} */
  const outcome = { state: 'pending', value: undefined, error: undefined, observed: Promise.resolve() };
  outcome.observed = promise.then(
    value => { outcome.state = 'fulfilled'; outcome.value = value; },
    error => { outcome.state = 'rejected'; outcome.error = error; }
  );
  return outcome;
}

/** @param {Uint8Array[]} chunks @param {number} [status] */
function nativeResponse(chunks, status = 200) {
  return new RootResponse(new RootReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  }), { status, headers: { 'content-type': 'application/json; charset=iso-8859-1' } });
}

/**
 * The complete publisher executes with native Response/ReadableStream objects,
 * root-realm Error/Abort constructors and fake timers. No network call, signing
 * operation, credential file or production helper is allowed.
 * @param {() => Response} responseFactory
 * @param {() => void} [release]
 */
function fixture(responseFactory, release = () => undefined) {
  /** @type {Array<{ url: string, init: FixtureInit }>} */
  const requests = [];
  /** @type {Response[]} */
  const responses = [];
  /** @type {Outcome[]} */
  const outcomes = [];
  /** @type {Set<ReturnType<typeof setTimeout>>} */
  const timers = new Set();
  const deny = () => { throw new Error('Unused helper access forbidden in native body fixture.'); };
  const dependencies = {
    crypto: { ...crypto, createSign: deny }, fs: { readFileSync: deny },
    './orbitCore': { buildPlayerClubSnapshot: deny, decodeVenueCoordinate: deny, getAccountKeyFromState: deny },
    './operations/dataProtection': { protectedIdentifier }
  };
  const module = { exports: {} };
  vm.runInNewContext(`${source}\nmodule.exports.__testWithFirebaseResponse = withFirebaseResponse;`, {
    module, Buffer, Date, JSON, URL, URLSearchParams, Error, TypeError, SyntaxError, AbortController, AbortSignal, DOMException,
    setTimeout(callback, delay, ...args) {
      const handle = setTimeout(() => { timers.delete(handle); callback(...args); }, delay);
      timers.add(handle); return handle;
    },
    clearTimeout(handle) { timers.delete(handle); clearTimeout(handle); },
    process: { env: Object.freeze({ NODE_ENV: 'test' }) },
    /** @param {string} input @param {FixtureInit} init */
    fetch(input, init) {
      assert.equal(input, endpoint);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers?.authorization, `Bearer ${token}`);
      assert.ok(init.signal instanceof AbortSignal);
      requests.push({ url: input, init });
      const response = responseFactory();
      assert.ok(response instanceof RootResponse);
      responses.push(response);
      // This deliberately ignores the signal: cleanup must own its body reader.
      return Promise.resolve(response);
    },
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), 'Unexpected native body fixture dependency.');
      return dependencies[name];
    }
  }, { filename: sourcePath });
  /** @type {(category: string, input: string, init: FixtureInit, path: string, consume: ConsumeResponse) => Promise<unknown>} */
  const request = Reflect.get(module.exports, '__testWithFirebaseResponse');
  /** @type {(project: string, accessToken: string, writes: Array<{ update: { name: string, fields: Record<string, unknown> } }>) => Promise<number>} */
  const batchWrite = Reflect.get(module.exports, 'batchWriteDocuments');
  assert.equal(typeof request, 'function');
  assert.equal(typeof batchWrite, 'function');
  /** @param {Promise<unknown>} promise */
  function track(promise) { outcomes.push(observe(promise)); return promise; }
  fixtureCleanups.push(async () => {
    release();
    await flush();
    await vi.advanceTimersByTimeAsync(budget + 1);
    await flush();
    for (const outcome of outcomes) {
      assert.notEqual(outcome.state, 'pending', 'Owned native body task must settle during cleanup.');
      await outcome.observed;
    }
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
  return {
    requests, responses, timers,
    /** @param {ConsumeResponse} consume */
    read(consume) {
      return track(request('native-body-probe', endpoint, { method: 'POST',
        headers: { authorization: `Bearer ${token}` }, body: '{}' }, diagnosticPath, consume));
    },
    batch(count = 1) {
      return track(batchWrite(projectId, token, Array.from({ length: count }, (_unused, index) => ({
        update: { name: `projects/${projectId}/databases/(default)/documents/synthetic/${index}`, fields: {} }
      }))));
    }
  };
}

const utf8 = value => Buffer.from(value, 'utf8');
const bytes = (...values) => Uint8Array.from(values);
/** @type {DecodingCase[]} */
const decodingCases = [
  { kind: 'text', label: 'chunked ASCII', chunks: [utf8('ab'), bytes(), utf8('cd')], expected: 'abcd' },
  { kind: 'text', label: 'split multibyte UTF-8', chunks: [...utf8('póker 🃏雪')].map(value => bytes(value)), expected: 'póker 🃏雪' },
  { kind: 'text', label: 'malformed and incomplete UTF-8 replacement', chunks: [utf8('a'), bytes(0xc3), bytes(0x28), bytes(0xf0, 0x9f)], expected: 'a�(�' },
  { kind: 'text', label: 'one split leading BOM removed and interior BOM preserved', chunks: [bytes(0xef), bytes(0xbb), bytes(0xbf), utf8('a\ufeffb')], expected: 'a\ufeffb' },
  { kind: 'text', label: 'two leading BOMs removed by Node 22 native decoding', chunks: [utf8('\ufeff\ufeffx')], expected: 'x' },
  { kind: 'text', label: 'third leading BOM retained by Node 22 native decoding', chunks: [utf8('\ufeff\ufeff\ufeffx')], expected: '\ufeffx' },
  { kind: 'text', label: 'empty stream', chunks: [], expected: '' },
  { kind: 'json', label: 'split BOM and multibyte JSON', chunks: [bytes(0xef), bytes(0xbb, 0xbf), ...[...utf8('{"name":"póker 🃏雪"}')].map(value => bytes(value))], expected: { name: 'póker 🃏雪' } },
  { kind: 'json', label: 'invalid UTF-8 inside a JSON string', chunks: [utf8('{"text":"'), bytes(0xc3, 0x28), utf8('"}')], expected: { text: '�(' } },
  { kind: 'json', label: 'two leading BOMs removed before JSON parsing', chunks: [utf8('\ufeff\ufeff{}')], expected: {} },
  { kind: 'json', label: 'null primitive', chunks: [utf8(' null ')], expected: null },
  { kind: 'json', label: 'false primitive', chunks: [utf8('false')], expected: false },
  { kind: 'json', label: 'number primitive', chunks: [utf8('1e3')], expected: 1000 },
  { kind: 'json', label: 'string primitive', chunks: [utf8('"synthetic"')], expected: 'synthetic' },
  { kind: 'json', label: 'array primitive contents', chunks: [utf8('[true,0,null,"x"]')], expected: [true, 0, null, 'x'] }
];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  try { for (const cleanup of fixtureCleanups.splice(0)) await cleanup(); }
  finally { vi.clearAllTimers(); vi.useRealTimers(); }
});

describe('native publisher body decoding characterization', () => {
  it.each(decodingCases)('preserves $kind decoding for $label', async ({ kind, chunks, expected }) => {
    const f = fixture(() => nativeResponse(chunks));
    await expect(f.read(response => response[kind]())).resolves.toEqual(expected);
    expect(f.requests).toHaveLength(1);
    expect(f.responses[0].bodyUsed).toBe(true);
    expect(f.timers.size).toBe(0);
  });

  it.each(['', ' ', '{invalid', '\ufeff\ufeff\ufeff{}'])('preserves native SyntaxError for invalid JSON %j', async text => {
    const f = fixture(() => nativeResponse([utf8(text)]));
    await expect(f.read(response => response.json())).rejects.toBeInstanceOf(SyntaxError);
    expect(f.responses[0].bodyUsed).toBe(true);
  });

  it('keeps null-body text reads repeatable without marking a missing body used', async () => {
    const f = fixture(() => new RootResponse(null));
    await expect(f.read(async response => [await response.text(), await response.text()])).resolves.toEqual(['', '']);
    expect(f.responses[0].body).toBe(null);
    expect(f.responses[0].bodyUsed).toBe(false);
  });

  it('keeps each missing-body JSON read a SyntaxError', async () => {
    const f = fixture(() => new RootResponse(null));
    await expect(f.read(async response => {
      await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
      await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
    })).resolves.toBeUndefined();
    expect(f.responses[0].bodyUsed).toBe(false);
  });

  it.each(['json', 'text'])('rejects a second %s read of a consumed stream with TypeError', async kind => {
    const f = fixture(() => nativeResponse([utf8('"synthetic"')]));
    await expect(f.read(async response => {
      expect(await response.text()).toBe('"synthetic"');
      return response[kind]();
    })).rejects.toBeInstanceOf(TypeError);
  });

  it('keeps a failed JSON parse as a consumed body for subsequent reads', async () => {
    const f = fixture(() => nativeResponse([utf8('{invalid')]));
    await expect(f.read(async response => {
      await expect(response.json()).rejects.toBeInstanceOf(SyntaxError);
      return response.text();
    })).rejects.toBeInstanceOf(TypeError);
  });
});

describe('native publisher response diagnostic contracts', () => {
  it('accepts a chunked BOM-prefixed native batch acknowledgement', async () => {
    const f = fixture(() => nativeResponse([bytes(0xef), bytes(0xbb, 0xbf), utf8('{"status":['), utf8('{}]}')]));
    await expect(f.batch()).resolves.toBe(1);
    expect(f.requests).toHaveLength(1);
  });

  it.each(['', '{invalid', 'null'])('retains invalid-batch category/status/pathRef for native JSON %j', async text => {
    const f = fixture(() => nativeResponse([utf8(text)]));
    await expect(f.batch()).rejects.toMatchObject({ name: 'FirebasePublicationError', code: 'FIREBASE_PUBLICATION_FAILED',
      category: 'batch-write-response-invalid', status: 0, pathRef: protectedIdentifier(endpoint) });
  });

  it('hashes decoded and truncated native HTTP error text with the batch status/path', async () => {
    const text = `\ufeff${'雪'.repeat(4097)}`;
    const f = fixture(() => nativeResponse([bytes(0xef), bytes(0xbb, 0xbf), utf8(text)], 429));
    await expect(f.batch()).rejects.toMatchObject({ name: 'FirebasePublicationError', code: 'FIREBASE_PUBLICATION_FAILED',
      category: 'batch-write', status: 429, pathRef: protectedIdentifier(endpoint),
      responseRef: protectedIdentifier('雪'.repeat(4096)) });
  });

  it('retains the empty native HTTP error-text reference', async () => {
    const f = fixture(() => nativeResponse([], 429));
    await expect(f.batch()).rejects.toMatchObject({ category: 'batch-write', status: 429,
      pathRef: protectedIdentifier(endpoint), responseRef: protectedIdentifier('empty-response:429') });
  });
});

describe('native publisher owned body-reader cleanup', () => {
  it.each([200, 429])('cancels a stalled native HTTP %s body when the adapter ignores abort', async status => {
    /** @type {ReadableStreamDefaultController<Uint8Array> | undefined} */
    let controller;
    const cancel = vi.fn(() => undefined);
    /** @type {ReadableStream<Uint8Array>} */
    const stream = new RootReadableStream({
      start(value) {
        controller = value;
        value.enqueue(utf8(status === 200 ? '{"status":[' : 'synthetic unfinished provider error'));
      },
      cancel
    });
    const f = fixture(() => new RootResponse(stream, { status }), () => {
      // Release a hidden native reader even when the old implementation fails.
      // error() is inert after a successful cancellation/close.
      controller?.error(new Error('Owned native body fixture cleanup.'));
    });
    const outcome = observe(f.batch(251));
    await flush();
    expect(f.requests).toHaveLength(1);
    expect(f.responses[0].body?.locked).toBe(true);
    expect(cancel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(budget);
    await flush();
    expect(outcome.state).toBe('rejected');
    expect(outcome.error).toMatchObject({ name: 'FirebasePublicationError', code: 'FIREBASE_PUBLICATION_FAILED',
      category: status === 200 ? 'batch-write-response-invalid' : 'batch-write',
      status: status === 200 ? 0 : 429, pathRef: protectedIdentifier(endpoint),
      responseRef: protectedIdentifier(status === 200 ? 'Firebase request deadline exceeded.' : 'unreadable-provider-response') });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0].init.signal?.aborted).toBe(true);
    expect(f.timers.size).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(f.responses[0].body?.locked).toBe(false);
    await vi.advanceTimersByTimeAsync(budget * 2);
    await flush();
    expect(f.requests).toHaveLength(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
