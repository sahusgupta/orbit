/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedState } from '../../../domain/state';
import type { AppState } from '../../../domain/types';
import type { PilotAccessValidationResult } from '../../../app/persistence/managementPersistence';
import { useManagementPilotAccessRefresh } from './useManagementPilotAccessRefresh';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const persistence = vi.hoisted(() => ({
  saveBrowserState: vi.fn(),
  saveDesktopState: vi.fn(),
  validate: vi.fn()
}));

vi.mock('../../../app/persistence/browserStateRepository', () => ({
  saveBrowserManagementState: persistence.saveBrowserState
}));

vi.mock('../../../app/persistence/managementPersistence', () => ({
  getManagementPilotAccessValidator: () => persistence.validate,
  saveDesktopManagementState: persistence.saveDesktopState
}));

const access = {
  authorized: true,
  authorizationCode: 'pilot-code',
  expiresAt: '2099-12-31T23:59:59.000Z',
  activatedAt: '2026-08-25T12:00:00.000Z',
  licenseId: 'club-one'
};

const buildState = (): AppState => ({
  ...structuredClone(seedState),
  settings: {
    ...structuredClone(seedState.settings),
    pilotAccess: access
  }
});

const RefreshHarness = ({
  getCurrentState,
  state
}: {
  getCurrentState: () => AppState;
  state: AppState;
}) => {
  const [, setState] = useState(state);
  useManagementPilotAccessRefresh({ getCurrentState, setState, state });
  return null;
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('management pilot access refresh', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    persistence.saveBrowserState.mockReset();
    persistence.saveDesktopState.mockReset();
    persistence.saveDesktopState.mockResolvedValue({ ok: true });
    persistence.validate.mockReset();
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it('publishes the latest state after deferred migration validation', async () => {
    let resolveValidation!: (result: PilotAccessValidationResult) => void;
    const deferredValidation = new Promise<PilotAccessValidationResult>((resolve) => {
      resolveValidation = resolve;
    });
    persistence.validate
      .mockReturnValueOnce(deferredValidation)
      .mockResolvedValueOnce({ ok: true, managed: true, active: true });
    const renderedState = buildState();
    let latestState = renderedState;

    await act(async () => {
      root.render(<RefreshHarness state={renderedState} getCurrentState={() => latestState} />);
      await flush();
    });
    latestState = {
      ...renderedState,
      settings: {
        ...renderedState.settings,
        staffAccounts: [{
          id: 'staff-latest',
          name: 'Latest Staff',
          role: 'Floor',
          pinSalt: 'salt',
          pinHash: 'hash',
          active: true,
          createdAt: '2026-08-25T12:01:00.000Z'
        }]
      }
    };

    await act(async () => {
      resolveValidation({ ok: true, managed: false, active: true });
      await flush();
    });

    expect(persistence.saveDesktopState).toHaveBeenCalledTimes(1);
    expect(persistence.saveDesktopState).toHaveBeenCalledWith(latestState);
    expect(persistence.validate).toHaveBeenCalledTimes(2);
  });

  it('does not publish a migration after the active account changes', async () => {
    let resolveValidation!: (result: PilotAccessValidationResult) => void;
    const deferredValidation = new Promise<PilotAccessValidationResult>((resolve) => {
      resolveValidation = resolve;
    });
    persistence.validate.mockReturnValueOnce(deferredValidation);
    const renderedState = buildState();
    const latestState: AppState = {
      ...renderedState,
      settings: {
        ...renderedState.settings,
        pilotAccess: { ...access, authorizationCode: 'other-pilot-code', licenseId: 'club-two' }
      }
    };

    await act(async () => {
      root.render(<RefreshHarness state={renderedState} getCurrentState={() => latestState} />);
      await flush();
    });
    await act(async () => {
      resolveValidation({ ok: true, managed: false, active: true });
      await flush();
    });

    expect(persistence.saveDesktopState).not.toHaveBeenCalled();
    expect(persistence.validate).toHaveBeenCalledTimes(1);
  });
});
