// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAccountKeyFromState } from '../../../domain/licensing';
import { normalizeState, seedState } from '../../../domain/state';
import type { AppState, PersistedStateRecord } from '../../../domain/types';
import * as persistence from '../../../app/persistence/managementPersistence';
import { adoptCanonicalManagementState, useManagementPlayerUpdateSync } from './useManagementPlayerUpdateSync';

vi.mock('../../../app/persistence/managementPersistence', () => ({
  hasManagementDesktopPersistence: vi.fn(),
  loadDesktopManagementStateForAccount: vi.fn(),
  subscribeToDesktopManagementStateForAccount: vi.fn(),
  loadManagementStateFromLocalBridge: vi.fn(),
  publishStateToLocalOrbitBridge: vi.fn()
}));

const source = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
const parsed = ts.createSourceFile('main.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function actualMainAdoption(scope: Record<string, unknown>) {
  let callback: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useManagementPlayerUpdateSync') {
      const options = node.arguments[0];
      if (options && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === 'onAuthoritativeState') {
            callback = property.initializer.getText(parsed);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!callback) throw new Error('Actual Main canonical-adoption callback missing');
  const compiled = ts.transpileModule(`const invoke = ${callback};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const value: unknown = Function(...Object.keys(scope), `${compiled}; return invoke;`)(...Object.values(scope));
  if (typeof value !== 'function') throw new Error('Actual Main canonical-adoption callback did not compose');
  return (canonical: AppState): void => value(canonical);
}

describe('desktop canonical adoption retains explicit recovery admission', () => {
  let root: Root;
  let container: HTMLDivElement;
  let stateRef: { current: AppState };
  let finishLoad: (record: PersistedStateRecord) => void;
  let originalActEnvironment: unknown;
  const load = vi.mocked(persistence.loadDesktopManagementStateForAccount);
  const setState = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    originalActEnvironment = Reflect.get(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const initial = normalizeState({
      ...structuredClone(seedState),
      settings: { ...structuredClone(seedState.settings), pilotAccess: {
        authorized: true, licenseId: 'admission-test', authorizationCode: 'synthetic-only-access',
        activatedAt: '2026-11-05', expiresAt: '2099-12-31'
      } }
    });
    initial.playerLedger = [{ id: 'retained-financial-marker', type: 'Buy-In', playerName: 'Synthetic', amount: 125.75, timestamp: '2026-11-05T00:00:00.000Z' }];
    stateRef = { current: adoptCanonicalManagementState(initial, initial) };
    finishLoad = () => { throw new Error('The actual desktop read did not start'); };
    vi.mocked(persistence.hasManagementDesktopPersistence).mockReturnValue(true);
    vi.mocked(persistence.subscribeToDesktopManagementStateForAccount).mockReturnValue(() => undefined);
    load.mockImplementation(() => new Promise((resolve) => { finishLoad = resolve; }));
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
    if (originalActEnvironment === undefined) Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
    else Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', originalActEnvironment);
  });

  async function mount(announce: (latest: AppState, remote: AppState) => void) {
    const accountKey = getAccountKeyFromState(stateRef.current);
    const durablePendingStatesRef = { current: new Map([[accountKey, stateRef.current]]) };
    const authResumeCanonicalRequiredAccountsRef = { current: new Set([accountKey]) };
    const onAuthoritativeState = vi.fn(actualMainAdoption({
      durablePendingStatesRef, authResumeCanonicalRequiredAccountsRef, getAccountKeyFromState, setSaveStatus: vi.fn()
    }));
    function Harness() {
      useManagementPlayerUpdateSync({
        activeAccountKey: accountKey, hasAuthenticated: true, state: stateRef.current, stateRef,
        announceIncomingPlayerRequest: announce, isManagementSavePending: () => false,
        setSaveStatus: vi.fn(), setState, clearUndo: vi.fn(), onAuthoritativeState
      });
      return null;
    }
    await act(async () => root.render(<Harness />));
    expect(load).toHaveBeenCalledOnce();
    return { accountKey, durablePendingStatesRef, authResumeCanonicalRequiredAccountsRef, onAuthoritativeState };
  }

  it.each(['announcer', 'announcement-storage'] as const)('retains the hold when %s fails before canonical adoption', async (failure) => {
    const announce = vi.fn(() => {
      if (failure === 'announcer') throw new Error('Synthetic announcement failure');
      localStorage.setItem('synthetic-announcement-marker', 'synthetic-only');
    });
    const h = await mount(announce);
    const original = stateRef.current;
    const originalLedger = structuredClone(original.playerLedger);
    if (failure === 'announcement-storage') {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Synthetic announcement storage failure'); });
    }
    const canonical: AppState = { ...structuredClone(original), staffRequests: [{
      id: 'synthetic-incoming-request', type: 'self-check-in-assistance', playerName: 'Synthetic',
      reason: 'not-found', status: 'pending', createdAt: '2026-11-05T00:01:00.000Z'
    }] };

    await act(async () => finishLoad({ state: canonical, authoritative: true, revision: 2, schemaVersion: 5, savedAt: '2026-11-05T00:01:00.000Z' }));

    expect(announce).toHaveBeenCalledOnce();
    expect(stateRef.current).toBe(original);
    expect(setState).not.toHaveBeenCalled();
    expect(stateRef.current.playerLedger).toEqual(originalLedger);
    expect(h.onAuthoritativeState).not.toHaveBeenCalled();
    expect(h.durablePendingStatesRef.current.get(h.accountKey)).toBe(original);
    expect(h.authResumeCanonicalRequiredAccountsRef.current.has(h.accountKey)).toBe(true);
  });

  it('releases the hold on the actual same-JSON canonical branch without repainting or announcing', async () => {
    const announce = vi.fn();
    const h = await mount(announce);
    const original = stateRef.current;
    const canonical = structuredClone(original);
    expect(JSON.stringify(adoptCanonicalManagementState(original, canonical))).toBe(JSON.stringify(original));

    await act(async () => finishLoad({ state: canonical, authoritative: true, revision: 2, schemaVersion: 5, savedAt: '2026-11-05T00:01:00.000Z' }));

    expect(h.onAuthoritativeState).toHaveBeenCalledOnce();
    expect(h.durablePendingStatesRef.current.has(h.accountKey)).toBe(false);
    expect(stateRef.current).toBe(original);
    expect(setState).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });
});
