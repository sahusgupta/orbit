// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState } from '../../../domain/types';
import { useManagementStartupSync } from './useManagementStartupSync';

const mocks = vi.hoisted(() => ({ load: vi.fn(), signIn: vi.fn(), cache: vi.fn() }));
vi.mock('../../../app/persistence/managementPersistence', () => ({ loadDesktopManagementState: mocks.load }));
vi.mock('../../../domain/licensing', async (original) => ({ ...await original<typeof import('../../../domain/licensing')>(), restorePersistedSignIn: mocks.signIn }));
vi.mock('../../../app/persistence/browserStateRepository', () => ({ saveBrowserManagementState: mocks.cache }));

afterEach(() => vi.clearAllMocks());

describe('management startup tenant ordering', () => {
  it.each([false, true])('applies async sign-in only while the original state remains current (account changed=%s)', async (changed) => {
    let current = structuredClone(seedState);
    const pending = { ...structuredClone(seedState), scriptTemplates: ['Retained local intent'] };
    let finishSignIn: (value: boolean) => void = () => { throw new Error('Sign-in did not begin.'); };
    mocks.load.mockResolvedValue({ state: pending, schemaVersion: 3, savedAt: '2026-11-03', authoritative: false, pending: true });
    mocks.signIn.mockImplementation(() => new Promise<boolean>((resolve) => { finishSignIn = resolve; }));
    const setState = vi.fn((next: React.SetStateAction<AppState>) => { current = typeof next === 'function' ? next(current) : next; });
    const auth = vi.fn();
    const status = vi.fn();
    const onPendingState = vi.fn();
    const container = document.createElement('div');
    const root = createRoot(container);
    function Harness() {
      useManagementStartupSync({ getCurrentState: () => current, hasAuthenticated: false,
        setState, setHasAuthenticated: auth, setSaveStatus: status, clearUndo: vi.fn(), onPendingState });
      return null;
    }
    try {
      await act(async () => root.render(<Harness />));
      expect(mocks.signIn).toHaveBeenCalledTimes(1);
      expect(setState).not.toHaveBeenCalled();
      if (changed) current = { ...structuredClone(seedState), scriptTemplates: ['Another account/view'] };
      await act(async () => { finishSignIn(true); await Promise.resolve(); });
      if (changed) {
        expect(setState).not.toHaveBeenCalled();
        expect(auth).not.toHaveBeenCalled();
        expect(mocks.cache).not.toHaveBeenCalled();
        expect(status).not.toHaveBeenCalled();
        expect(onPendingState).not.toHaveBeenCalled();
      } else {
        expect(setState).toHaveBeenCalledTimes(1);
        expect(auth).toHaveBeenCalledWith(true);
        expect(status).toHaveBeenCalledWith({ state: 'error', message: 'Pending locally; server confirmation required' });
        expect(onPendingState).toHaveBeenCalledTimes(1);
      }
    } finally { await act(async () => root.unmount()); }
  });
});
