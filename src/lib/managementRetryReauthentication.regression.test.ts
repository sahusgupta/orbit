import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { getAccountKeyFromAccess, getAccountKeyFromState, isPilotAccessActive } from '../domain/licensing';
import { seedState } from '../domain/state';
import type { AppState, PilotAccess } from '../domain/types';
import { checkpointSha256 } from '../app/persistence/checkpointProtocol';
import { compactManagementUsageTelemetry, getManagementStatePayloadBytes, getManagementStatePayloadError } from '../app/persistence/managementStatePayload';
import { managementSaveOutcome } from '../application/management/mutationResult';

// Execute the actual Main closures with controlled ports. These cases do not
// replace their authentication, account-adoption or retry rules with a model.
const mainSource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.tsx', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findInitializer(name: string): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = node.initializer.getText(parsed);
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  return found;
}

function compose(name: string, scope: Record<string, unknown>, dependencies: readonly string[] = []) {
  const target = findInitializer(name);
  if (!target) throw new Error(`Actual Main initializer ${name} missing`);
  return composeExpression(target, scope, dependencies);
}

function composeExpression(target: string, scope: Record<string, unknown>, dependencies: readonly string[] = []) {
  const explicitResume = findInitializer('resumePendingAfterExplicitAuthentication');
  const resumeDeclaration = explicitResume
    ? `const resumePendingAfterExplicitAuthentication = ${explicitResume};`
    : '';
  const dependencyDeclarations = dependencies.map((dependency) => {
    const body = findInitializer(dependency);
    if (!body) throw new Error(`Actual Main dependency ${dependency} missing`);
    return `const ${dependency} = ${body};`;
  }).join('\n');
  const compiled = ts.transpileModule(`${resumeDeclaration}\n${dependencyDeclarations}\nconst invoke = ${target};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const value: unknown = Function(...Object.keys(scope), `${compiled}; return invoke;`)(...Object.values(scope));
  if (typeof value !== 'function') throw new Error(`Actual Main helper ${name} did not load`);
  return (...args: unknown[]): Promise<unknown> => value(...args);
}

function mainCallback(name: 'onManagementSaveStatus' | 'onAuthoritativeState'): string {
  let found: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      if (name === 'onManagementSaveStatus' && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === name && node.arguments[0]) {
        found = node.arguments[0].getText(parsed);
      }
      if (name === 'onAuthoritativeState' && ts.isIdentifier(node.expression)
        && node.expression.text === 'useManagementPlayerUpdateSync') {
        const options = node.arguments[0];
        if (options && ts.isObjectLiteralExpression(options)) {
          for (const property of options.properties) {
            if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && property.name.text === name) {
              found = property.initializer.getText(parsed);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!found) throw new Error(`Actual Main callback ${name} missing`);
  return found;
}

function fixture(label: string): AppState {
  const state = structuredClone(seedState);
  state.scriptTemplates = [label];
  state.settings.pilotAccess = {
    authorized: true,
    authorizationCode: 'synthetic-retry-access',
    licenseId: 'retry-fixture',
    expiresAt: '2099-12-31',
    activatedAt: '2026-11-05T00:00:00.000Z'
  };
  state.settings.accountLogin = {
    username: 'synthetic@example.test',
    passwordSalt: 'synthetic-retry-salt',
    passwordHash: 'pbkdf2-sha256$synthetic-retry-verifier',
    createdAt: '2026-11-05T00:00:00.000Z'
  };
  return state;
}

function accessFrom(state: AppState): PilotAccess {
  const access = state.settings.pilotAccess;
  if (!access) throw new Error('Synthetic pilot access missing');
  return access;
}

function deferred<T>() {
  let finish: (value: T) => void = () => { throw new Error('Deferred port did not initialize'); };
  const promise = new Promise<T>((resolve) => { finish = resolve; });
  return { promise, finish: (value: T) => finish(value) };
}

function ports() {
  const stateRef = { current: fixture('original visible state') };
  const saveSequenceRef = { current: 7 };
  const resumePendingManagementState = vi.fn(async (_access: PilotAccess) => ({ ok: true, pending: true }));
  const bridge: { resumePendingManagementState?: typeof resumePendingManagementState } = { resumePendingManagementState };
  const persistSignIn = vi.fn(async (_next: AppState, _stay: boolean) => true);
  const signOutOfFirebase = vi.fn(async () => undefined);
  const setPilotKeyError = vi.fn();
  const windowPort = { tableManagerDesktop: bridge, location: { hash: '' } };
  const loadExistingManagementStateForAccount = vi.fn(async (_access: PilotAccess): Promise<AppState | null> => null);
  const restorePersistedSignIn = vi.fn(async (_state: AppState) => true);
  const waitForPendingManagementSaves = vi.fn(async () => undefined);
  const setState = vi.fn((next: AppState) => { stateRef.current = next; });
  const scope = {
    persistSignIn,
    signOutOfFirebase,
    setPilotKeyError,
    stateRef,
    saveSequenceRef,
    window: windowPort,
    getAccountKeyFromAccess,
    getAccountKeyFromState,
    waitForPendingManagementSaves,
    loadExistingManagementStateForAccount,
    restorePersistedSignIn,
    staffSelectionAttemptRef: { current: 0 },
    setTrustedStaffSession: vi.fn(),
    setUndoAction: vi.fn(),
    setState,
    saveBrowserManagementState: vi.fn(),
    setHasAuthenticated: vi.fn(),
    setPendingPilotAccess: vi.fn(),
    getManagementDurablePendingAdmission: vi.fn(() => ({ pending: false })),
    durablePendingStatesRef: { current: new Map<string, AppState>() },
    authResumeCanonicalRequiredAccountsRef: { current: new Set<string>() },
    setSaveStatus: vi.fn()
  };
  return {
    ...scope,
    bridge,
    windowPort,
    resumePendingManagementState,
    signIn: compose('persistRequestedSignIn', scope),
    adoptKey: compose('loadExistingAccountState', scope)
  };
}

describe('explicit Main authentication retry-resume boundary', () => {
  it('does not reach sign-in persistence or recovery after the actual password-verification branch rejects', async () => {
    const h = ports();
    const verifyStaffSecret = vi.fn(async () => false);
    const preventDefault = vi.fn();
    const invoke = compose('signInToAccount', {
      state: h.stateRef.current,
      loginDraft: { username: 'synthetic@example.test', password: 'synthetic-incorrect-password', staySignedIn: true },
      isPilotAccessActive,
      verifyStaffSecret,
      setPilotKeyError: h.setPilotKeyError,
      persistRequestedSignIn: h.signIn
    });

    await invoke({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(verifyStaffSecret).toHaveBeenCalledExactlyOnceWith(
      'synthetic-incorrect-password', 'synthetic-retry-salt', 'pbkdf2-sha256$synthetic-retry-verifier'
    );
    expect(h.persistSignIn).not.toHaveBeenCalled();
    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
    expect(h.setPilotKeyError).toHaveBeenCalledExactlyOnceWith('Email or password is incorrect.');
  });

  it.each([true, false])('signals recovery only after successful explicit sign-in, staySignedIn=%s', async (stay) => {
    const h = ports();
    const next = fixture('successful explicit sign-in');
    const expectedAccess = structuredClone(accessFrom(next));
    const gate = deferred<boolean>();
    h.persistSignIn.mockImplementationOnce(() => gate.promise);

    const result = h.signIn(next, stay);
    expect(h.persistSignIn).toHaveBeenCalledExactlyOnceWith(next, stay);
    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
    gate.finish(true);

    await expect(result).resolves.toBe(true);
    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(expectedAccess);
    expect(h.resumePendingManagementState.mock.calls[0]).toEqual([expectedAccess]);
    expect(h.resumePendingManagementState.mock.calls[0]).not.toContain(next);
    expect(h.signOutOfFirebase).not.toHaveBeenCalled();
  });

  it('does not signal recovery after explicit authentication persistence fails', async () => {
    const h = ports();
    h.persistSignIn.mockResolvedValueOnce(false);

    await expect(h.signIn(fixture('failed explicit sign-in'), true)).resolves.toBe(false);

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
    expect(h.signOutOfFirebase).toHaveBeenCalledOnce();
    expect(h.setPilotKeyError).toHaveBeenCalledOnce();
  });

  it('does not signal recovery when secure sign-in storage rejects', async () => {
    const h = ports();
    h.persistSignIn.mockRejectedValueOnce(new Error('Synthetic storage failure'));

    await expect(h.signIn(fixture('storage failure'), false)).rejects.toThrow('Synthetic storage failure');

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });

  it.each(['state-reference', 'save-sequence'] as const)('does not signal recovery if %s changes during sign-in', async (change) => {
    const h = ports();
    const gate = deferred<boolean>();
    h.persistSignIn.mockImplementationOnce(() => gate.promise);
    const result = h.signIn(fixture('held sign-in'), true);
    expect(h.persistSignIn).toHaveBeenCalledOnce();

    if (change === 'state-reference') h.stateRef.current = fixture('newer same-account visible state');
    else h.saveSequenceRef.current += 1;
    gate.finish(true);
    await result;

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });

  it('keeps successful sign-in when the optional recovery bridge is unavailable', async () => {
    const h = ports();
    delete h.bridge.resumePendingManagementState;

    await expect(h.signIn(fixture('older optional bridge'), false)).resolves.toBe(true);

    expect(h.persistSignIn).toHaveBeenCalledOnce();
    expect(h.signOutOfFirebase).not.toHaveBeenCalled();
  });

  it('keeps successful sign-in when the recovery request rejects', async () => {
    const h = ports();
    const next = fixture('recovery request unavailable');
    h.resumePendingManagementState.mockRejectedValueOnce(new Error('Synthetic recovery connection failure'));

    await expect(h.signIn(next, true)).resolves.toBe(true);

    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(accessFrom(next));
    expect(h.signOutOfFirebase).not.toHaveBeenCalled();
  });

  it('records pending admission before the actual sign-in continuation can submit an older financial snapshot', async () => {
    const h = ports();
    const original = h.stateRef.current;
    original.playerLedger = [{
      id: 'retained-financial-marker', type: 'Buy-In', playerName: 'Synthetic retained player',
      amount: 125.75, timestamp: '2026-11-05T00:00:00.000Z'
    }];
    const originalLedger = structuredClone(original.playerLedger);
    const saveManagementState = vi.fn(async () => ({ ok: true, path: 'unexpected-older-snapshot-save' }));
    const withUsageEvent = vi.fn((next: AppState) => next);
    const invoke = compose('signInToAccount', {
      ...h,
      state: original,
      loginDraft: { username: 'synthetic@example.test', password: 'synthetic-valid-password', staySignedIn: false },
      isPilotAccessActive,
      verifyStaffSecret: vi.fn(async () => true),
      canUseRendererFirebaseAuth: () => false,
      nowIso: () => '2026-11-05T01:00:00.000Z',
      pendingManagementSaveCountsRef: { current: new Map<string, number>() },
      saveManagementState,
      withUsageEvent
    }, ['persistRequestedSignIn', 'persist']);
    expect(h.durablePendingStatesRef.current.size).toBe(0);

    await invoke({ preventDefault: vi.fn() });

    expect(h.persistSignIn).toHaveBeenCalledOnce();
    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(accessFrom(original));
    expect(h.setHasAuthenticated).toHaveBeenCalledExactlyOnceWith(true);
    expect(h.durablePendingStatesRef.current.get(getAccountKeyFromState(original))).toBe(original);
    expect(h.setSaveStatus).toHaveBeenCalledWith(expect.objectContaining({ state: 'error', message: expect.stringContaining('retained locally') }));
    expect(saveManagementState).not.toHaveBeenCalled();
    expect(withUsageEvent).not.toHaveBeenCalled();
    expect(h.stateRef.current).toBe(original);
    expect(original.playerLedger).toEqual(originalLedger);
    expect(h.saveSequenceRef.current).toBe(7);
  });

  it('keeps actual persistence blocked after a matching ACK until the canonical frame is adopted', async () => {
    const h = ports();
    const original = h.stateRef.current;
    original.playerLedger = [{ id: 'original-financial-marker', type: 'Buy-In', playerName: 'Synthetic player', amount: 125.75, timestamp: '2026-11-05T00:00:00.000Z' }];
    const accountKey = getAccountKeyFromState(original);
    const pendingManagementSaveCountsRef = { current: new Map<string, number>() };
    const hash = vi.fn(checkpointSha256);
    const saveManagementState = vi.fn(async (_next: AppState) => ({ ok: true, pending: false, path: 'synthetic-port', cloud: 'server-pending', revision: 2 }));
    const scope = {
      ...h,
      pendingManagementSaveCountsRef,
      checkpointSha256: hash,
      pendingManagementSaveRef: { current: Promise.resolve({ ok: true }) },
      getManagementSaveAdmissionBytes: () => 33_554_432,
      compactManagementUsageTelemetry,
      getManagementStatePayloadBytes,
      getManagementStatePayloadError,
      managementSaveOutcome,
      withUsageEvent: (next: AppState) => next,
      mutationDiagnostic: vi.fn(),
      saveManagementState
    };
    const persist = compose('persist', scope);
    const acknowledge = composeExpression(mainCallback('onManagementSaveStatus'), scope);
    const canonicalAdopted = composeExpression(mainCallback('onAuthoritativeState'), scope);
    await expect(h.signIn(original, false)).resolves.toBe(true);
    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(accessFrom(original));
    expect(h.durablePendingStatesRef.current.get(accountKey)).toBe(original);
    expect(pendingManagementSaveCountsRef.current.size).toBe(0);
    const oldSnapshot = { ...original, scriptTemplates: ['old visible snapshot'] };
    await expect(persist(oldSnapshot, false)).resolves.toMatchObject({ ok: false, status: 'busy' });
    expect(saveManagementState).not.toHaveBeenCalled();

    const sourceHash = await checkpointSha256(new TextEncoder().encode(JSON.stringify(original)));
    acknowledge({ accountKey, ok: true, pending: false, sourceHash, revision: 1, publication: { status: 'pending' } });
    expect(hash).toHaveBeenCalledOnce();
    await expect(hash.mock.results[0].value).resolves.toBe(sourceHash);
    await Promise.resolve();

    await expect(persist(oldSnapshot, false)).resolves.toMatchObject({ ok: false, status: 'busy' });
    expect(saveManagementState).not.toHaveBeenCalled();
    expect(h.stateRef.current).toBe(original);
    const canonical = fixture('complete canonical financial state');
    canonical.playerLedger = [...original.playerLedger, { id: 'canonical-financial-marker', type: 'Cash-Out', playerName: 'Synthetic player', amount: 250.5, timestamp: '2026-11-05T00:01:00.000Z' }];
    // The real guarded hook must adopt this frame before notifying Main. This
    // composition models that boundary; it does not replace or claim the hook's guards.
    h.stateRef.current = canonical;
    canonicalAdopted(canonical);
    const next = { ...canonical, scriptTemplates: ['next action from canonical frame'] };
    await expect(persist(next, false)).resolves.toMatchObject({ ok: true });
    expect(saveManagementState).toHaveBeenCalledExactlyOnceWith(next);
    expect(next.playerLedger).toEqual(canonical.playerLedger);
    expect(next.playerLedger.map((row) => row.id)).toEqual(['original-financial-marker', 'canonical-financial-marker']);
  });
});

describe('explicit signed-key account adoption retry-resume boundary', () => {
  it('signals access-only recovery after successful same-account key adoption without loading a replacement snapshot', async () => {
    const h = ports();
    const access = { ...accessFrom(h.stateRef.current), authorizationCode: 'synthetic-renewed-access' };

    await expect(h.adoptKey(access, { preserveCurrentAccount: true })).resolves.toBe(true);

    expect(h.waitForPendingManagementSaves).toHaveBeenCalledOnce();
    expect(h.loadExistingManagementStateForAccount).not.toHaveBeenCalled();
    expect(h.restorePersistedSignIn).toHaveBeenCalledOnce();
    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(access);
    expect(h.resumePendingManagementState.mock.calls[0]).toEqual([access]);
    expect(h.stateRef.current.settings.pilotAccess).toEqual(access);
    expect(h.stateRef.current.scriptTemplates).toEqual(['original visible state']);
  });

  it('signals access-only recovery after the actual loaded-account adoption branch succeeds', async () => {
    const h = ports();
    const access = { ...accessFrom(h.stateRef.current), authorizationCode: 'synthetic-imported-access' };
    const loaded = fixture('canonical adopted account');
    loaded.settings.pilotAccess = access;
    h.loadExistingManagementStateForAccount.mockResolvedValueOnce(loaded);

    await expect(h.adoptKey(access)).resolves.toBe(true);

    expect(h.loadExistingManagementStateForAccount).toHaveBeenCalledExactlyOnceWith(access);
    expect(h.stateRef.current).toBe(loaded);
    expect(h.restorePersistedSignIn).toHaveBeenCalledExactlyOnceWith(loaded);
    expect(h.resumePendingManagementState).toHaveBeenCalledExactlyOnceWith(access);
    expect(h.resumePendingManagementState.mock.calls[0]).toEqual([access]);
    expect(h.resumePendingManagementState.mock.calls[0]).not.toContain(loaded);
  });

  it('does not interpret the handled load-failure true result as successful authentication or recovery', async () => {
    const h = ports();
    const original = h.stateRef.current;
    h.loadExistingManagementStateForAccount.mockRejectedValueOnce(new Error('Synthetic canonical load failure'));

    await expect(h.adoptKey(accessFrom(original))).resolves.toBe(true);

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
    expect(h.restorePersistedSignIn).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
    expect(h.stateRef.current).toBe(original);
    expect(h.setPilotKeyError).toHaveBeenCalledExactlyOnceWith('Synthetic canonical load failure');
  });

  it('does not signal recovery when the requested account was not found', async () => {
    const h = ports();

    await expect(h.adoptKey(accessFrom(h.stateRef.current))).resolves.toBe(false);

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
    expect(h.restorePersistedSignIn).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
  });

  it.each(['state-reference', 'save-sequence'] as const)('does not signal recovery if %s changes during an imported-account read', async (change) => {
    const h = ports();
    const access = accessFrom(h.stateRef.current);
    const gate = deferred<AppState | null>();
    h.loadExistingManagementStateForAccount.mockImplementationOnce(() => gate.promise);
    const result = h.adoptKey(access);
    expect(h.loadExistingManagementStateForAccount).toHaveBeenCalledExactlyOnceWith(access);

    if (change === 'state-reference') h.stateRef.current = fixture('newer account view during import');
    else h.saveSequenceRef.current += 1;
    gate.finish(fixture('late imported account'));
    await result;

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });

  it.each([
    { preserveCurrentAccount: true, change: 'state-reference' },
    { preserveCurrentAccount: true, change: 'save-sequence' },
    { preserveCurrentAccount: false, change: 'state-reference' },
    { preserveCurrentAccount: false, change: 'save-sequence' }
  ])('does not signal recovery after $change during session restoration (preserveCurrentAccount=$preserveCurrentAccount)', async ({ preserveCurrentAccount, change }) => {
    const h = ports();
    const access = accessFrom(h.stateRef.current);
    const entered = deferred<void>();
    const gate = deferred<boolean>();
    const loaded = fixture('imported account before session restore');
    h.loadExistingManagementStateForAccount.mockResolvedValueOnce(loaded);
    h.restorePersistedSignIn.mockImplementationOnce(() => {
      entered.finish(undefined);
      return gate.promise;
    });
    const result = h.adoptKey(access, { preserveCurrentAccount });
    await entered.promise;
    expect(h.restorePersistedSignIn).toHaveBeenCalledOnce();

    if (change === 'state-reference') h.stateRef.current = fixture('newer visible state during session restore');
    else h.saveSequenceRef.current += 1;
    gate.finish(true);
    await result;

    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });
});
