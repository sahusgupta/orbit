import type { NightCloseTable } from '../../lib/nightClose';
import type {
  AppState,
  NightCloseAudit,
  NightCloseRecord,
  NightCloseStatus,
  NightRecord,
  StaffAccount
} from '../../domain/types';

export type CloseoutCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
  todayDate: () => string;
};

export type CloseoutInputs = {
  current?: NightCloseRecord;
  tables: NightCloseTable[];
  warnings: string[];
  notes: string;
};

export type CloseoutTotals = {
  discrepancy: number;
};

export type CloseoutFailureCode =
  | 'locked'
  | 'missing-staff'
  | 'missing-tables'
  | 'missing-actual'
  | 'manager-required'
  | 'staff-sign-required'
  | 'missing-close';

export type CloseoutFailure = {
  ok: false;
  code: CloseoutFailureCode;
  state: AppState;
  message?: string;
};

const activeStaff = (state: AppState) =>
  state.settings.staffAccounts.find((account) => account.id === state.settings.activeStaffId);

const isManager = (staff?: StaffAccount) => Boolean(staff && ['Owner', 'Manager'].includes(staff.role));

const createAudit = (
  state: AppState,
  action: NightCloseAudit['action'],
  dependencies: CloseoutCommandDependencies,
  note?: string
): NightCloseAudit => {
  const staff = activeStaff(state);
  return {
    id: dependencies.createId(),
    action,
    timestamp: dependencies.nowIso(),
    staffId: staff?.id,
    staffName: staff?.name ?? 'Unassigned staff',
    staffRole: staff?.role,
    note
  };
};

const replaceClose = (state: AppState, record: NightCloseRecord): AppState => ({
  ...state,
  nightCloses: [...state.nightCloses.filter((close) => close.id !== record.id), record]
});

export function saveNightClose(
  state: AppState,
  inputs: CloseoutInputs,
  nextStatus: NightCloseStatus,
  dependencies: CloseoutCommandDependencies
): CloseoutFailure | { ok: true; state: AppState; record: NightCloseRecord } {
  if (inputs.current?.status === 'Locked') return { ok: false, code: 'locked', state };
  const timestamp = dependencies.nowIso();
  const auditEntry = createAudit(state, inputs.current ? 'Saved' : 'Created', dependencies);
  const record: NightCloseRecord = {
    id: inputs.current?.id ?? dependencies.createId(),
    date: dependencies.todayDate(),
    status: nextStatus,
    createdAt: inputs.current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    notes: inputs.notes || inputs.current?.notes || '',
    tables: inputs.tables,
    warnings: inputs.warnings,
    staffSignOff: inputs.current?.staffSignOff,
    managerSignOff: inputs.current?.managerSignOff,
    audit: [...(inputs.current?.audit ?? []), auditEntry]
  };
  return { ok: true, state: replaceClose(state, record), record };
}

export function signNightClose(
  state: AppState,
  inputs: CloseoutInputs,
  totals: CloseoutTotals,
  dependencies: CloseoutCommandDependencies
): CloseoutFailure | { ok: true; state: AppState; record: NightCloseRecord } {
  if (!activeStaff(state)) {
    return { ok: false, code: 'missing-staff', state, message: 'Select the staff member operating this station before signing.' };
  }
  if (!inputs.tables.length) {
    return { ok: false, code: 'missing-tables', state, message: 'There are no tables in the current shift to reconcile.' };
  }
  if (inputs.tables.some((table) => table.actualCash === undefined)) {
    return { ok: false, code: 'missing-actual', state, message: 'Enter an actual cash count for every table before staff sign-off.' };
  }
  const timestamp = dependencies.nowIso();
  const signOff = createAudit(state, 'Staff Signed', dependencies, `Discrepancy ${totals.discrepancy.toFixed(2)}`);
  const record: NightCloseRecord = {
    id: inputs.current?.id ?? dependencies.createId(),
    date: dependencies.todayDate(),
    status: 'Staff Signed',
    createdAt: inputs.current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    notes: inputs.notes || inputs.current?.notes || '',
    tables: inputs.tables,
    warnings: inputs.warnings,
    staffSignOff: signOff,
    managerSignOff: undefined,
    audit: [...(inputs.current?.audit ?? []), signOff]
  };
  return { ok: true, state: replaceClose(state, record), record };
}

export function getNightCloseLockError(state: AppState, current?: NightCloseRecord): string | undefined {
  if (!isManager(activeStaff(state))) return 'A Manager or Owner must be selected to approve and lock the night.';
  if (current?.status !== 'Staff Signed') return 'Staff sign-off is required before manager approval.';
  return undefined;
}

export function lockNightClose(
  state: AppState,
  inputs: CloseoutInputs & { current: NightCloseRecord },
  totals: CloseoutTotals,
  currentNight: NightRecord,
  dependencies: CloseoutCommandDependencies
): CloseoutFailure | { ok: true; state: AppState; record: NightCloseRecord } {
  const validationMessage = getNightCloseLockError(state, inputs.current);
  if (validationMessage) {
    return {
      ok: false,
      code: isManager(activeStaff(state)) ? 'staff-sign-required' : 'manager-required',
      state,
      message: validationMessage
    };
  }
  const timestamp = dependencies.nowIso();
  const approval = createAudit(
    state,
    'Manager Approved',
    dependencies,
    `Locked with discrepancy ${totals.discrepancy.toFixed(2)}`
  );
  const lockedTables = inputs.tables.map((table) => ({
    ...table,
    warnings: table.warnings.filter((warning) => warning !== 'Table is still open')
  }));
  const lockedWarnings = Array.from(new Set(
    lockedTables.flatMap((table) => table.warnings.map((warning) => `${table.tableLabel}: ${warning}`))
  ));
  const record: NightCloseRecord = {
    ...inputs.current,
    status: 'Locked',
    updatedAt: timestamp,
    lockedAt: timestamp,
    notes: inputs.notes || inputs.current.notes,
    tables: lockedTables,
    warnings: lockedWarnings,
    managerSignOff: approval,
    audit: [...inputs.current.audit, approval]
  };
  const hasHistoryForDate = state.history.some((night) => night.date === record.date);
  return {
    ok: true,
    record,
    state: {
      ...state,
      nightCloses: [...state.nightCloses.filter((close) => close.id !== record.id), record],
      history: hasHistoryForDate
        ? state.history
        : [...state.history, { ...currentNight, id: dependencies.createId(), notes: record.notes }],
      interests: [],
      sessions: state.sessions.map((session) => ({
        ...session,
        status: 'Closed' as const,
        endedAt: session.endedAt ?? timestamp
      })),
      playerSessions: state.playerSessions.map((session) => ({
        ...session,
        leftAt: session.leftAt ?? timestamp
      })),
      tableEvents: [
        ...state.tableEvents,
        ...state.sessions.filter((session) => session.status !== 'Closed').map((session) => ({
          id: dependencies.createId(),
          type: 'Closed' as const,
          gameId: session.gameId,
          tableId: session.id,
          timestamp,
          playerCount: session.seatsFilled,
          note: 'Night reconciliation locked'
        }))
      ]
    }
  };
}

export function getNightCloseReopenError(state: AppState, current?: NightCloseRecord): string | undefined {
  if (!current || !isManager(activeStaff(state))) return 'A Manager or Owner must be selected to reopen a close.';
  return undefined;
}

export function reopenNightClose(
  state: AppState,
  current: NightCloseRecord,
  reason: string,
  dependencies: CloseoutCommandDependencies
): CloseoutFailure | { ok: true; state: AppState; record: NightCloseRecord } {
  const validationMessage = getNightCloseReopenError(state, current);
  if (validationMessage) return { ok: false, code: 'manager-required', state, message: validationMessage };
  const auditEntry = createAudit(state, 'Reopened', dependencies, reason);
  const record: NightCloseRecord = {
    ...current,
    status: 'Draft',
    updatedAt: auditEntry.timestamp,
    lockedAt: undefined,
    managerSignOff: undefined,
    audit: [...current.audit, auditEntry]
  };
  return { ok: true, state: replaceClose(state, record), record };
}
