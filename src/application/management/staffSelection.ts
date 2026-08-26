import type { PilotAccess, StaffAccount } from '../../domain/types';

export const staffPinInputPattern = '[0-9]{4,12}';
const staffPinPattern = /^\d{4,12}$/;

export type StaffSession = {
  token: string;
  staffId: string;
  role: StaffAccount['role'];
  expiresAt: string;
  accountKey: string;
};

export type StaffSelectionSaveResult = {
  ok: boolean;
  error?: string;
};

type StaffPinVerification = {
  ok: boolean;
  token?: string;
  staffId?: string;
  role?: StaffAccount['role'];
  accountKey?: string;
  expiresAt?: string;
  error?: string;
};

type ActivateStaffSelectionOptions = {
  access?: PilotAccess;
  accountKey: string;
  pendingSave: Promise<StaffSelectionSaveResult>;
  requestPin: () => Promise<string | null>;
  staffId: string;
  verifyStaffPin?: (payload: {
    staffId: string;
    pin: string;
    access: PilotAccess;
  }) => Promise<StaffPinVerification>;
};

export type StaffSelectionResult =
  | { ok: true; session: StaffSession }
  | { ok: false; canceled: true }
  | { ok: false; error: string };

export const isValidStaffPin = (pin: string) => staffPinPattern.test(pin);

export const isStaffAdministratorRole = (role: StaffAccount['role']) =>
  role === 'Owner' || role === 'Manager';

export const hasActiveStaffAdministrator = (staffAccounts: StaffAccount[]) =>
  staffAccounts.some((staff) => staff.active && isStaffAdministratorRole(staff.role));

export const activateStaffSelection = async ({
  access,
  accountKey,
  pendingSave,
  requestPin,
  staffId,
  verifyStaffPin
}: ActivateStaffSelectionOptions): Promise<StaffSelectionResult> => {
  if (!access || !accountKey || !verifyStaffPin) {
    return { ok: false, error: 'Trusted desktop staff verification is unavailable.' };
  }

  const requestedPin = await requestPin();
  if (requestedPin === null) return { ok: false, canceled: true };
  const pin = requestedPin.trim();
  if (!isValidStaffPin(pin)) return { ok: false, error: 'Staff verification failed.' };

  const saveResult = await pendingSave.catch(() => ({ ok: false }));
  if (!saveResult.ok) {
    return {
      ok: false,
      error: 'Resolve the current save issue before selecting a staff account.'
    };
  }

  try {
    const result = await verifyStaffPin({ staffId, pin, access });
    if (
      !result.ok ||
      result.staffId !== staffId ||
      result.accountKey !== accountKey ||
      !result.token ||
      !result.role ||
      !result.expiresAt
    ) {
      return { ok: false, error: result.error || 'Staff verification failed.' };
    }
    return {
      ok: true,
      session: {
        token: result.token,
        staffId: result.staffId,
        role: result.role,
        expiresAt: result.expiresAt,
        accountKey: result.accountKey
      }
    };
  } catch {
    return { ok: false, error: 'Staff verification is temporarily unavailable.' };
  }
};
