import {
  getAccountKeyFromAccess,
  isFutureDate,
  safeAccountKeyPart,
  validatePilotKey,
  type PilotKeyValidationResult
} from '../../domain/licensing';
import type { PilotAccess } from '../../domain/types';

export type PilotAccessValidationResult = {
  ok: boolean;
  managed: boolean;
  active: boolean;
  license?: {
    licenseId?: string;
    accountKey?: string;
    issuedTo?: string;
    expiresAt?: string;
    status?: string;
  } | null;
  error?: string;
};

type PilotAccessValidator = (access: PilotAccess) => Promise<PilotAccessValidationResult>;

type PilotKeyImportDependencies = {
  getPilotAccessValidator?: () => PilotAccessValidator | undefined;
  validateKey?: typeof validatePilotKey;
};

export type PilotKeyImportResult = PilotKeyValidationResult & {
  renewedFromServer?: boolean;
};

const renewalConfirmationError = (expiresAt: string) =>
  `This pilot key expired on ${expiresAt}, and Orbit could not confirm an active renewal. `
  + 'Connect this desktop to the internet, confirm the matching license is active, and try again.';

const renewalIdentityError =
  'Orbit confirmed a renewal for a different pilot account. Use the key issued for this card house.';

export const resolvePilotKeyImport = async (
  licenseFile: unknown,
  fileName?: string,
  dependencies: PilotKeyImportDependencies = {}
): Promise<PilotKeyImportResult> => {
  const validateKey = dependencies.validateKey ?? validatePilotKey;
  const validation = await validateKey(licenseFile, fileName, { allowExpired: true });
  if (validation.error || !validation.access) return validation;
  if (!validation.expired) return { access: validation.access };

  const validatePilotAccess = dependencies.getPilotAccessValidator?.();
  const expiredAt = validation.access.expiresAt;
  if (!validatePilotAccess) return { error: renewalConfirmationError(expiredAt) };

  let serverResult: PilotAccessValidationResult | null = null;
  try {
    serverResult = await validatePilotAccess(validation.access);
  } catch {
    serverResult = null;
  }

  const serverLicense = serverResult?.license;
  if (
    !serverResult?.ok ||
    !serverResult.managed ||
    !serverResult.active ||
    !serverLicense?.expiresAt ||
    !isFutureDate(serverLicense.expiresAt) ||
    serverLicense.status !== 'active'
  ) {
    return { error: renewalConfirmationError(expiredAt) };
  }

  const signedAccountKey = getAccountKeyFromAccess(validation.access);
  const serverAccountKey = safeAccountKeyPart(serverLicense.accountKey || serverLicense.licenseId || '');
  const signedLicenseId = safeAccountKeyPart(validation.access.licenseId || '');
  const serverLicenseId = safeAccountKeyPart(serverLicense.licenseId || '');
  if (
    !signedAccountKey ||
    !serverAccountKey ||
    signedAccountKey !== serverAccountKey ||
    (signedLicenseId && (!serverLicenseId || signedLicenseId !== serverLicenseId))
  ) {
    return { error: renewalIdentityError };
  }

  return {
    access: {
      ...validation.access,
      expiresAt: serverLicense.expiresAt,
      serverManaged: true
    },
    renewedFromServer: true
  };
};
