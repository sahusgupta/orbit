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
