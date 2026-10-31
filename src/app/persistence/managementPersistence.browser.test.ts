// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { seedState } from '../../domain/state';
import { loadManagementStateFromLocalBridge, publishStateToLocalOrbitBridge } from './managementPersistence';

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });
it('retains browser revisions across public wrapper calls and requires a reload after conflict', async () => {
  const state = structuredClone(seedState);
  const accountKey = 'browser-revision-test';
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  let revision = 7;
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ accountKey, state, revision }));
    const payload = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    if (payload.expectedRevision !== revision) return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
    revision += 1;
    return new Response(JSON.stringify({ ok: true, revision }));
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  revision = 10;
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  await loadManagementStateFromLocalBridge(accountKey);
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  expect(attempts).toEqual([7, 8, 9, 9, 10]);
});

it('preserves accepted public-wrapper reads when the caller explicitly accepts the snapshot', async () => {
  const state = structuredClone(seedState);
  const accountKey = 'browser-explicit-acceptance';
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ accountKey, state, revision: 4 }));
    const payload = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    return new Response(JSON.stringify({ ok: true, revision: 5 }));
  }));
  await expect(loadManagementStateFromLocalBridge(accountKey, () => true)).resolves.toEqual({ status: 'available', state });
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  expect(attempts).toEqual([4]);
});

it('keeps purposeful default reloads complete and does not replay a failed save automatically', async () => {
  const state = structuredClone(seedState);
  const accountKey = 'browser-purposeful-default';
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  const remote = structuredClone(state);
  remote.settings.defaultHourlyFee = 37;
  let revision = 1;
  const posts: Array<{ expectedRevision: number; state: typeof state }> = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ accountKey, state: revision === 1 ? state : remote, revision }));
    const payload: { expectedRevision: number; state: typeof state } = JSON.parse(String(init.body));
    posts.push(payload);
    if (payload.expectedRevision !== revision) return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, revision: ++revision }));
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  revision = 2;
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  const loaded = await loadManagementStateFromLocalBridge(accountKey);
  expect(loaded).toEqual({ status: 'available', state: remote });
  expect(posts).toHaveLength(2);
  if (loaded.status !== 'available' || !loaded.state) throw new Error('The purposeful read did not return the complete state.');
  expect((await publishStateToLocalOrbitBridge(loaded.state)).ok).toBe(true);
  expect(posts.map(post => post.expectedRevision)).toEqual([1, 1, 2]);
  expect(posts[2].state.settings.defaultHourlyFee).toBe(37);
});

it('forwards rejection through the public loader without adopting its revision or replaying a conflict', async () => {
  const state = structuredClone(seedState);
  const accountKey = 'browser-rejected-public-read';
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  let revision = 3;
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ accountKey, state, revision }));
    const payload = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    if (payload.expectedRevision !== revision) return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, revision: ++revision }));
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  revision = 4;
  const canAcceptRead = vi.fn(() => false);
  await expect(loadManagementStateFromLocalBridge(accountKey, canAcceptRead)).resolves.toEqual({ status: 'unavailable' });
  expect(canAcceptRead).toHaveBeenCalledOnce();
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect(attempts).toEqual([3, 3]);
  await loadManagementStateFromLocalBridge(accountKey);
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  expect(attempts).toEqual([3, 3, 4]);
});

it('propagates a throwing acceptance predicate after JSON without adopting its revision', async () => {
  const state = structuredClone(seedState);
  const accountKey = 'browser-throwing-public-read';
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  let revision = 11;
  let bodyConsumed = false;
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') {
      const response = new Response(JSON.stringify({ accountKey, state, revision }));
      const readJson = response.json.bind(response);
      vi.spyOn(response, 'json').mockImplementation(async () => {
        const payload = await readJson();
        bodyConsumed = true;
        return payload;
      });
      return response;
    }
    const payload = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    if (payload.expectedRevision !== revision) return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, revision: ++revision }));
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  revision = 12;
  bodyConsumed = false;
  const failure = new Error('Synthetic rejected acceptance.');
  const canAcceptRead = vi.fn(() => {
    expect(bodyConsumed).toBe(true);
    throw failure;
  });
  await expect(loadManagementStateFromLocalBridge(accountKey, canAcceptRead)).rejects.toBe(failure);
  expect(canAcceptRead).toHaveBeenCalledOnce();
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect(attempts).toEqual([11]);
  await loadManagementStateFromLocalBridge(accountKey);
  expect((await publishStateToLocalOrbitBridge(state)).ok).toBe(true);
  expect(attempts).toEqual([11, 12]);
});

it.each(['fetch', 'malformed JSON'])('preserves %s failure identity and the previous revision for default and gated reads', async mode => {
  const state = structuredClone(seedState);
  const accountKey = `browser-failed-read-${mode === 'fetch' ? 'fetch' : 'json'}`;
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  let revision = 1;
  let failRead = false;
  let jsonFailure: unknown;
  const fetchFailure = new Error('Synthetic fetch rejection.');
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') {
      if (!failRead) return new Response(JSON.stringify({ accountKey, state, revision }));
      if (mode === 'fetch') throw fetchFailure;
      const response = new Response('{');
      const readJson = response.json.bind(response);
      vi.spyOn(response, 'json').mockImplementation(async () => {
        try { return await readJson(); }
        catch (error) { jsonFailure = error; throw error; }
      });
      return response;
    }
    const payload = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  revision = 2;
  failRead = true;
  const canAcceptRead = vi.fn(() => true);
  for (const accept of [undefined, canAcceptRead]) {
    let failure: unknown;
    try { await loadManagementStateFromLocalBridge(accountKey, accept); }
    catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(failure).toBe(mode === 'fetch' ? fetchFailure : jsonFailure);
  }
  expect(canAcceptRead).not.toHaveBeenCalled();
  expect((await publishStateToLocalOrbitBridge(state)).conflict).toBe(true);
  expect(attempts).toEqual([1]);
});

const deferredReadFixture = async (name: string) => {
  const state = structuredClone(seedState);
  const accountKey = `browser-deferred-${name}`;
  state.settings.pilotAccess = { authorized: true, licenseId: accountKey, authorizationCode: 'test-only', activatedAt: '2026-09-10', expiresAt: '2099-12-31' };
  let revision = 1;
  const attempts: number[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'POST') return new Response(JSON.stringify({ accountKey, state, revision }));
    const payload: { expectedRevision: number } = JSON.parse(String(init.body));
    attempts.push(payload.expectedRevision);
    if (payload.expectedRevision !== revision) return new Response(JSON.stringify({ currentRevision: revision }), { status: 409 });
    return new Response(JSON.stringify({ ok: true, revision: ++revision }));
  }));
  await loadManagementStateFromLocalBridge(accountKey);
  return { state, accountKey, attempts, setRevision(value: number) { revision = value; } };
};

it('forwards deferred acceptance through the public loader without evaluating or adopting until committed', async () => {
  const f = await deferredReadFixture('forwarding');
  f.setRevision(2);
  const canAcceptRead = vi.fn(() => true);
  const loaded = await loadManagementStateFromLocalBridge(f.accountKey, canAcceptRead, { deferRevisionAcceptance: true });
  expect(loaded.status).toBe('available');
  expect(canAcceptRead).not.toHaveBeenCalled();
  expect((await publishStateToLocalOrbitBridge(f.state)).conflict).toBe(true);
  expect(f.attempts).toEqual([1]);
  if (loaded.status !== 'available' || !loaded.acceptReadRevision) throw new Error('Deferred read did not expose its acceptance callback.');
  expect(loaded.state).toEqual(f.state);
  expect(loaded.acceptReadRevision()).toBe(true);
  expect(canAcceptRead).toHaveBeenCalledOnce();
  expect((await publishStateToLocalOrbitBridge(f.state)).ok).toBe(true);
  expect(f.attempts).toEqual([1, 2]);
});

it('defers revision adoption without requiring a predicate', async () => {
  const f = await deferredReadFixture('no-predicate');
  f.setRevision(2);
  const loaded = await loadManagementStateFromLocalBridge(f.accountKey, undefined, { deferRevisionAcceptance: true });
  expect((await publishStateToLocalOrbitBridge(f.state)).conflict).toBe(true);
  expect(f.attempts).toEqual([1]);
  if (loaded.status !== 'available' || !loaded.acceptReadRevision) throw new Error('Deferred read did not expose its acceptance callback.');
  expect(loaded.acceptReadRevision()).toBe(true);
  expect((await publishStateToLocalOrbitBridge(f.state)).ok).toBe(true);
  expect(f.attempts).toEqual([1, 2]);
});

it('evaluates a deferred predicate at commit and retains the old revision after late rejection', async () => {
  const f = await deferredReadFixture('late-rejection');
  f.setRevision(2);
  let accepts = true;
  const canAcceptRead = vi.fn(() => accepts);
  const loaded = await loadManagementStateFromLocalBridge(f.accountKey, canAcceptRead, { deferRevisionAcceptance: true });
  expect(canAcceptRead).not.toHaveBeenCalled();
  accepts = false;
  if (loaded.status !== 'available' || !loaded.acceptReadRevision) throw new Error('Deferred read did not expose its acceptance callback.');
  expect(loaded.acceptReadRevision()).toBe(false);
  expect(canAcceptRead).toHaveBeenCalledOnce();
  expect((await publishStateToLocalOrbitBridge(f.state)).conflict).toBe(true);
  expect(f.attempts).toEqual([1]);
});

it('preserves a late deferred predicate error without adopting its revision', async () => {
  const f = await deferredReadFixture('late-error');
  f.setRevision(2);
  let failure: Error | undefined;
  const canAcceptRead = vi.fn(() => {
    if (failure) throw failure;
    return true;
  });
  const loaded = await loadManagementStateFromLocalBridge(f.accountKey, canAcceptRead, { deferRevisionAcceptance: true });
  expect(canAcceptRead).not.toHaveBeenCalled();
  failure = new Error('Synthetic late deferred acceptance failure.');
  if (loaded.status !== 'available' || !loaded.acceptReadRevision) throw new Error('Deferred read did not expose its acceptance callback.');
  let thrown: unknown;
  try { loaded.acceptReadRevision(); }
  catch (error) { thrown = error; }
  expect(thrown).toBe(failure);
  expect(canAcceptRead).toHaveBeenCalledOnce();
  expect((await publishStateToLocalOrbitBridge(f.state)).conflict).toBe(true);
  expect(f.attempts).toEqual([1]);
});

it.each(['read', 'save'] as const)('does not let an older deferred snapshot replace a newer revision from a %s', async source => {
  const f = await deferredReadFixture(`newer-${source}`);
  const loaded = await loadManagementStateFromLocalBridge(f.accountKey, undefined, { deferRevisionAcceptance: true });
  if (loaded.status !== 'available' || !loaded.acceptReadRevision) throw new Error('Deferred read did not expose its acceptance callback.');
  if (source === 'read') {
    f.setRevision(3);
    await loadManagementStateFromLocalBridge(f.accountKey);
  } else expect((await publishStateToLocalOrbitBridge(f.state)).ok).toBe(true);
  expect(loaded.acceptReadRevision()).toBe(false);
  expect((await publishStateToLocalOrbitBridge(f.state)).ok).toBe(true);
  expect(f.attempts).toEqual(source === 'read' ? [3] : [1, 2]);
});
