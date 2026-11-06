/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import typescriptModule from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AppShell from '../components/AppShell';
import { seedState } from '../domain/state';
import { getAccountKeyFromState } from '../domain/licensing';
import type { AppState } from '../domain/types';
import type { ManagementSaveResult } from '../domain/managementSaveResult';
import type { SaveStatus } from '../features/settings/settingsWorkspace';
import { startTableWithPlayers } from '../application/management/tableCommands';
import { compactManagementUsageTelemetry, getManagementStatePayloadBytes, getManagementStatePayloadError } from '../app/persistence/managementStatePayload';
import { managementSaveOutcome } from '../application/management/mutationResult';

const ts = typescriptModule;
const source = readFileSync(path.resolve('src/main.tsx'), 'utf8');
const parsed = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const instant = '2026-11-06T00:00:00.000Z';

// Run the actual Main closures and pure table transition. Only their external
// persistence/UI ports are controlled; the real AppShell renders the status.
function initializer(name: string) {
  let found: string | undefined;
  const visit = (node: typescriptModule.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!found) throw new Error(`Actual Main initializer ${name} missing`);
  return found;
}

function compose(name: string, scope: Record<string, unknown>) {
  const compiled = ts.transpileModule(`const invoke = ${initializer(name)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const value: unknown = Function(...Object.keys(scope), `${compiled}; return invoke;`)(...Object.values(scope));
  if (typeof value !== 'function') throw new Error(`Actual Main initializer ${name} did not load`);
  return (...args: unknown[]): unknown => Reflect.apply(value, undefined, args);
}

function fixture(licenseId = 'start-status-fixture'): AppState {
  const state = structuredClone(seedState);
  state.settings.pilotAccess = { authorized: true, authorizationCode: 'synthetic-start-status-key', licenseId, expiresAt: '2099-12-31', activatedAt: instant };
  state.settings.staffAccounts = [];
  state.games = [{ id: 'game-status', name: 'Synthetic game', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 2, minTotalForViable: 4 }];
  state.sessions = [{ id: 'table-status', gameId: 'game-status', label: 'Synthetic table', status: 'Forming', seatsFilled: 0, maxSeats: 8, timeFeeBased: false, collectionMode: 'Drop', tags: [], startedAt: instant }];
  state.interests = [];
  state.playerSessions = [];
  state.tableEvents = [];
  return state;
}

function deferred<T>() {
  let finish: (value: T) => void = () => { throw new Error('Deferred port was not initialized'); };
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, finish: (value: T) => finish(value) };
}

const cleanups: Array<() => void> = [];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(instant));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  cleanups.push(() => { act(() => root.unmount()); container.remove(); });
  const state = fixture();
  const stateRef = { current: state };
  const statuses: SaveStatus[] = [];
  let status: SaveStatus = { state: 'idle', message: 'Not saved' };
  const render = () => root.render(<AppShell active="floor" clubName="Synthetic club" saveState={status.state} onNavigate={() => undefined} onSignOut={() => undefined}><main>Floor</main></AppShell>);
  const setSaveStatus = (next: SaveStatus) => { status = next; statuses.push(next); render(); };
  const saveManagementState = vi.fn<(_state: AppState) => Promise<ManagementSaveResult>>();
  const recordClientEvent = vi.fn(async () => ({ ok: true }));
  const durablePendingStatesRef = { current: new Map<string, AppState>() };
  const saveSequenceRef = { current: 0 };
  const setStartPlayerDrafts = vi.fn();
  const persist = compose('persist', {
    stateRef, saveSequenceRef, durablePendingStatesRef, authResumeCanonicalRequiredAccountsRef: { current: new Set<string>() },
    pendingManagementSaveCountsRef: { current: new Map<string, number>() }, pendingManagementSaveRef: { current: Promise.resolve({ ok: true }) },
    window, getAccountKeyFromState, getManagementDurablePendingAdmission: () => ({ pending: false }),
    getManagementSaveAdmissionBytes: () => 33_554_432, withUsageEvent: (next: AppState) => next,
    compactManagementUsageTelemetry, getManagementStatePayloadBytes, getManagementStatePayloadError,
    getManagementStatePayloadContributions: () => [], mutationDiagnostic: vi.fn(),
    createManagementUndoEntry: () => null, setUndoAction: vi.fn(), staffSelectionAttemptRef: { current: 0 }, setTrustedStaffSession: vi.fn(),
    setState: vi.fn(), setSaveStatus, saveManagementState, managementSaveOutcome
  });
  let nextId = 0;
  const start = compose('startSessionWithPlayers', {
    state, startPlayerDrafts: {}, getClubDisplayName: () => 'Synthetic club', startTableWithPlayers,
    persist, setSaveStatus, window: { setTimeout: window.setTimeout.bind(window), tableManagerDesktop: { recordClientEvent } },
    uid: () => `synthetic-start-${++nextId}`, nowIso: () => instant, setStartPlayerDrafts, route: 'floor'
  });
  act(render);
  return { state, stateRef, statuses, status: () => status, label: () => container.querySelector('.orbit-sync-state')?.textContent,
    saveManagementState, recordClientEvent, durablePendingStatesRef, setStartPlayerDrafts,
    start: () => act(() => { start(state.sessions[0]); }),
    persist: (next: AppState) => { let result: unknown; act(() => { result = persist(next); }); return result; }
  };
}

async function flush() { await act(async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }); }
async function pastMessageTimer() { await act(async () => { await vi.advanceTimersByTimeAsync(351); }); await flush(); }
const accepted: ManagementSaveResult = { ok: true, path: 'synthetic', revision: 2, cloud: 'published' };
const failedResults: Array<{ label: string; result: ManagementSaveResult }> = [
  { label: 'durably pending', result: { ok: false, path: 'synthetic', pending: true, error: 'Synthetic retained pending save', cloud: 'not-committed' } },
  { label: 'rejected', result: { ok: false, path: 'synthetic', error: 'Synthetic server rejection', cloud: 'not-committed' } }
];

describe('actual start-table persistence and visible confirmation', () => {
  it('keeps a deferred save visibly saving past the old messaging timer', async () => {
    const h = harness(); const gate = deferred<ManagementSaveResult>();
    h.saveManagementState.mockReturnValue(gate.promise);
    h.start(); await flush(); await pastMessageTimer();
    expect(h.saveManagementState).toHaveBeenCalledOnce();
    expect(h.label()).toBe('Saving to server');
    expect(h.status().state).toBe('saving');
    gate.finish(accepted); await flush();
  });

  it.each(failedResults)('keeps a $label result visibly unconfirmed', async ({ result }) => {
    const h = harness(); h.saveManagementState.mockResolvedValue(result);
    h.start(); await flush(); await pastMessageTimer();
    expect(h.label()).toBe('Sync issue');
    expect(h.status()).toMatchObject({ state: 'error' });
    expect(h.status().message).toContain(result.error);
    expect(h.durablePendingStatesRef.current.has(getAccountKeyFromState(h.state))).toBe(Boolean(result.pending));
  });

  it('confirms a successful ACK and retains the existing table transition and telemetry', async () => {
    const h = harness(); h.saveManagementState.mockResolvedValue(accepted);
    h.start(); await flush(); await pastMessageTimer();
    expect(h.label()).toBe('Server saved');
    expect(h.saveManagementState).toHaveBeenCalledOnce();
    expect(h.stateRef.current.sessions[0]).toMatchObject({ id: 'table-status', status: 'Running', seatsFilled: 0 });
    expect(h.stateRef.current.tableEvents).toEqual([expect.objectContaining({ type: 'Started', playerCount: 0, note: 'Started empty - messaging trigger: Synthetic club' })]);
    expect(h.recordClientEvent).toHaveBeenCalledExactlyOnceWith('table-started', 'tables', { gameId: 'game-status', tableId: 'table-status', tableLabel: 'Synthetic table', playerCount: 0, selectedPlayers: 0, alreadySeated: 0 }, 'floor');
    expect(h.setStartPlayerDrafts).toHaveBeenCalledOnce();
  });

  it('does not overwrite a newer same-venue save while its ACK is held', async () => {
    const h = harness(); const newer = deferred<ManagementSaveResult>();
    h.saveManagementState.mockResolvedValueOnce(accepted).mockReturnValueOnce(newer.promise);
    h.start(); await flush();
    const next = structuredClone(h.stateRef.current); next.scriptTemplates = ['Synthetic newer save'];
    h.persist(next); await flush(); await pastMessageTimer();
    expect(h.saveManagementState).toHaveBeenCalledTimes(2);
    expect(h.label()).toBe('Saving to server');
    expect(h.stateRef.current).toBe(next);
    newer.finish(accepted); await flush();
  });

  it('does not confirm a different venue from the old table-start timer or late ACK', async () => {
    const h = harness(); const original = deferred<ManagementSaveResult>(); const nextVenue = deferred<ManagementSaveResult>();
    h.saveManagementState.mockReturnValueOnce(original.promise).mockReturnValueOnce(nextVenue.promise);
    h.start(); await flush();
    const next = fixture('synthetic-other-venue'); h.persist(next);
    original.finish(accepted); await flush(); await pastMessageTimer();
    expect(h.saveManagementState).toHaveBeenCalledTimes(2);
    expect(h.label()).toBe('Saving to server');
    expect(h.stateRef.current).toBe(next);
    nextVenue.finish(accepted); await flush();
  });
});
