import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AppState } from '../../../domain/types';
import { saveBrowserManagementState } from '../../../app/persistence/browserStateRepository';
import {
  getManagementPilotAccessValidator,
  saveDesktopManagementState
} from '../../../app/persistence/managementPersistence';

type ManagementPilotAccessRefreshOptions = {
  getCurrentState: () => AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  state: AppState;
};

export const useManagementPilotAccessRefresh = ({
  getCurrentState,
  setState,
  state
}: ManagementPilotAccessRefreshOptions) => {
  useEffect(() => {
    const access = state.settings.pilotAccess;
    const validatePilotAccess = getManagementPilotAccessValidator();
    if (!access?.authorizationCode || !validatePilotAccess) return undefined;
    let cancelled = false;

    const refresh = async () => {
      // A failed advisory refresh leaves the currently activated signed access unchanged.
      let result = await validatePilotAccess(access).catch(() => null);
      if (cancelled || !result) return;
      if (!result.managed) {
        // One-time migration: publishing the already activated signed key lets the
        // API register it without asking the venue to load a replacement file.
        const currentState = getCurrentState();
        if (currentState.settings.pilotAccess?.authorizationCode !== access.authorizationCode) return;
        await saveDesktopManagementState(currentState)?.catch(() => undefined);
        result = await validatePilotAccess(access).catch(() => null);
      }
      if (cancelled || !result?.managed || !result.license?.expiresAt) return;
      setState((current) => {
        const currentAccess = current.settings.pilotAccess;
        if (!currentAccess || currentAccess.authorizationCode !== access.authorizationCode) return current;
        if (currentAccess.expiresAt === result.license!.expiresAt && currentAccess.serverManaged) return current;
        const next = {
          ...current,
          settings: {
            ...current.settings,
            pilotAccess: {
              ...currentAccess,
              expiresAt: result.license!.expiresAt!,
              issuedTo: result.license!.issuedTo || currentAccess.issuedTo,
              licenseId: result.license!.licenseId || currentAccess.licenseId,
              serverManaged: true
            }
          }
        };
        saveBrowserManagementState(next);
        // The refreshed value is already durable in browser storage; desktop mirroring is best-effort here.
        saveDesktopManagementState(next)?.catch(() => undefined);
        return next;
      });
    };

    void refresh();
    const timer = window.setInterval(refresh, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [state.settings.pilotAccess?.authorizationCode, state.settings.pilotAccess?.licenseId]);
};
