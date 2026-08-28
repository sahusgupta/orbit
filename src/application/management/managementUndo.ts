import { getAccountKeyFromState } from '../../domain/licensing';
import type { AppState } from '../../domain/types';

type ProtectedStateKey = 'selfCheckIn' | 'settings' | 'usageEvents';
type ProtectedSettingsKey = 'accountLogin' | 'activeStaffId' | 'pilotAccess' | 'staffAccounts';

export type OperationalManagementState = Omit<AppState, ProtectedStateKey> & {
  settings: Omit<AppState['settings'], ProtectedSettingsKey>;
};

export type ManagementUndoSnapshot = {
  accountKey: string;
  operationalState: OperationalManagementState;
};

export type ManagementUndoEntry = {
  accountKey: string;
  before: ManagementUndoSnapshot;
  after: ManagementUndoSnapshot;
};

const cloneOperationalState = (state: AppState): OperationalManagementState => {
  const {
    accountLogin: _accountLogin,
    activeStaffId: _activeStaffId,
    pilotAccess: _pilotAccess,
    staffAccounts: _staffAccounts,
    ...operationalSettings
  } = state.settings;
  const {
    selfCheckIn: _selfCheckIn,
    settings: _settings,
    usageEvents: _usageEvents,
    ...operationalState
  } = state;

  return structuredClone({
    ...operationalState,
    settings: operationalSettings
  });
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.hasOwn(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key]));
};

export const createManagementUndoSnapshot = (state: AppState): ManagementUndoSnapshot => ({
  accountKey: getAccountKeyFromState(state),
  operationalState: cloneOperationalState(state)
});

export const hasSameManagementUndoAccount = (
  state: AppState,
  snapshot: ManagementUndoSnapshot
) => getAccountKeyFromState(state) === snapshot.accountKey;

export const hasEqualOperationalManagementState = (
  state: AppState,
  snapshot: ManagementUndoSnapshot
) => hasSameManagementUndoAccount(state, snapshot) &&
  deepEqual(cloneOperationalState(state), snapshot.operationalState);

export const isManagementUndoEntryStale = (
  state: AppState,
  entry: ManagementUndoEntry
) => entry.accountKey !== getAccountKeyFromState(state) ||
  entry.after.accountKey !== entry.accountKey ||
  !hasEqualOperationalManagementState(state, entry.after);

export const createManagementUndoEntry = (
  beforeState: AppState,
  afterState: AppState
): ManagementUndoEntry | null => {
  const before = createManagementUndoSnapshot(beforeState);
  const after = createManagementUndoSnapshot(afterState);
  if (before.accountKey !== after.accountKey || deepEqual(before.operationalState, after.operationalState)) return null;
  return { accountKey: before.accountKey, before, after };
};

export const restoreManagementUndoEntry = (
  currentState: AppState,
  entry: ManagementUndoEntry
): AppState | null => {
  if (
    isManagementUndoEntryStale(currentState, entry) ||
    entry.before.accountKey !== entry.accountKey
  ) return null;

  const restoredOperationalState = structuredClone(entry.before.operationalState);
  return {
    ...currentState,
    ...restoredOperationalState,
    settings: {
      ...currentState.settings,
      ...restoredOperationalState.settings
    }
  };
};
