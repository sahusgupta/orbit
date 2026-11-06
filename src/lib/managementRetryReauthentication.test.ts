import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { getAccountKeyFromAccess, getAccountKeyFromState } from '../domain/licensing';

const mainSource = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('main.tsx', mainSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name: string): string {
  let found: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) found = node.initializer.getText(parsed);
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  if (!found) throw new Error(`Actual Main initializer ${name} missing`);
  return found;
}
function setup(persisted: boolean) {
  const persistSignIn = vi.fn(async () => persisted);
  const signOutOfFirebase = vi.fn(async () => undefined);
  const setPilotKeyError = vi.fn();
  const resumePendingManagementState = vi.fn(async () => ({ ok: true, pending: true }));
  const stateRef: { current: unknown } = { current: undefined };
  const saveSequenceRef = { current: 0 };
  const durablePendingStatesRef = { current: new Map<string, unknown>() };
  const authResumeCanonicalRequiredAccountsRef = { current: new Set<string>() };
  const compiled = ts.transpileModule(`
    const resumePendingAfterExplicitAuthentication = ${initializer('resumePendingAfterExplicitAuthentication')};
    const invoke = ${initializer('persistRequestedSignIn')};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText;
  const value: unknown = Function('persistSignIn', 'signOutOfFirebase', 'setPilotKeyError', 'window',
    'stateRef', 'saveSequenceRef', 'durablePendingStatesRef', 'authResumeCanonicalRequiredAccountsRef', 'getAccountKeyFromAccess', 'getAccountKeyFromState',
    compiled + '; return invoke;')(
    persistSignIn, signOutOfFirebase, setPilotKeyError, { tableManagerDesktop: { resumePendingManagementState } },
    stateRef, saveSequenceRef, durablePendingStatesRef, authResumeCanonicalRequiredAccountsRef, getAccountKeyFromAccess, getAccountKeyFromState
  );
  if (typeof value !== 'function') throw new Error('Actual Main helper did not load');
  return { invoke: (next: unknown, stay: boolean): Promise<unknown> => {
    stateRef.current = next;
    return value(next, stay);
  }, persistSignIn, signOutOfFirebase, setPilotKeyError, resumePendingManagementState };
}
const next = () => ({ settings: { pilotAccess: { licenseId: 'retry-fixture', authorizationCode: 'synthetic-only-access' } } });

describe('existing explicit Main sign-in boundary before retry policy', () => {
  it.each([false, true])('keeps successful explicit sign-in for staySignedIn=%s', async stay => {
    const h = setup(true); const state = next();
    await expect(h.invoke(state, stay)).resolves.toBe(true);
    expect(h.persistSignIn).toHaveBeenCalledExactlyOnceWith(state, stay);
    expect(h.signOutOfFirebase).not.toHaveBeenCalled();
    expect(h.setPilotKeyError).not.toHaveBeenCalled();
  });
  it('retains the exact unsuccessful sign-in result and error', async () => {
    const h = setup(false);
    await expect(h.invoke(next(), true)).resolves.toBe(false);
    expect(h.signOutOfFirebase).toHaveBeenCalledOnce();
    expect(h.setPilotKeyError).toHaveBeenCalledExactlyOnceWith('Orbit could not securely save this sign-in choice. Check local app storage access and try again.');
    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });
  it('preserves a storage rejection before any recovery request', async () => {
    const h = setup(true); h.persistSignIn.mockRejectedValueOnce(new Error('Synthetic storage failure'));
    await expect(h.invoke(next(), false)).rejects.toThrow('Synthetic storage failure');
    expect(h.resumePendingManagementState).not.toHaveBeenCalled();
  });
});
