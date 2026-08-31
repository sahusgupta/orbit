import { describe, expect, it, vi } from 'vitest';
import type { PilotKeyValidationResult } from '../../domain/licensing';
import type { PilotAccess } from '../../domain/types';
import type { PilotAccessValidationResult } from '../../app/persistence/managementPersistence';
import { resolvePilotKeyImport } from './pilotKeyImport';

const expiredAccess: PilotAccess = {
  authorized: true,
  authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA',
  expiresAt: '2026-08-22',
  activatedAt: '2026-08-31T12:00:00.000Z',
  keyFileName: 'aggieland-poker-club-pilot-key.json',
  issuedTo: 'Aggieland Poker Club',
  issuedAt: '2026-08-01T12:00:00.000Z',
  licenseId: 'lic_aggieland'
};

const currentAccess: PilotAccess = {
  ...expiredAccess,
  expiresAt: '2099-12-31'
};

const keyValidation = (result: PilotKeyValidationResult) => vi.fn(async () => result);
const serverValidation = (result: PilotAccessValidationResult) => vi.fn(async () => result);

describe('pilot key import renewal resolution', () => {
  it('keeps a locally current signed key offline-compatible without contacting the server', async () => {
    const validateKey = keyValidation({ access: currentAccess });
    const getPilotAccessValidator = vi.fn();

    await expect(resolvePilotKeyImport({}, 'current.json', {
      validateKey,
      getPilotAccessValidator
    })).resolves.toEqual({ access: currentAccess });

    expect(validateKey).toHaveBeenCalledWith({}, 'current.json', { allowExpired: true });
    expect(getPilotAccessValidator).not.toHaveBeenCalled();
  });

  it('accepts an authentic expired key only when the matching managed license is active', async () => {
    const validatePilotAccess = serverValidation({
      ok: true,
      managed: true,
      active: true,
      license: {
        accountKey: 'lic_aggieland',
        licenseId: 'lic_aggieland',
        issuedTo: 'Aggieland Poker Club',
        status: 'active',
        expiresAt: '2099-10-01T23:59:59.999Z'
      }
    });

    await expect(resolvePilotKeyImport({}, expiredAccess.keyFileName, {
      validateKey: keyValidation({ access: expiredAccess, expired: true }),
      getPilotAccessValidator: () => validatePilotAccess
    })).resolves.toEqual({
      access: {
        ...expiredAccess,
        expiresAt: '2099-10-01T23:59:59.999Z',
        serverManaged: true
      },
      renewedFromServer: true
    });
    expect(validatePilotAccess).toHaveBeenCalledWith(expiredAccess);
  });

  it.each([
    ['offline', null],
    ['unmanaged', { ok: true, managed: false, active: false }],
    ['inactive', {
      ok: true,
      managed: true,
      active: false,
      license: {
        accountKey: 'lic_aggieland',
        licenseId: 'lic_aggieland',
        status: 'revoked',
        expiresAt: '2099-10-01T23:59:59.999Z'
      }
    }],
    ['malformed expiration', {
      ok: true,
      managed: true,
      active: true,
      license: {
        accountKey: 'lic_aggieland',
        licenseId: 'lic_aggieland',
        status: 'active',
        expiresAt: 'not-a-date'
      }
    }],
    ['missing status', {
      ok: true,
      managed: true,
      active: true,
      license: {
        accountKey: 'lic_aggieland',
        licenseId: 'lic_aggieland',
        expiresAt: '2099-10-01T23:59:59.999Z'
      }
    }]
  ])('fails closed when renewal confirmation is %s', async (_case, response) => {
    const validatePilotAccess = response === null
      ? vi.fn(async () => { throw new Error('offline'); })
      : serverValidation(response as PilotAccessValidationResult);

    await expect(resolvePilotKeyImport({}, expiredAccess.keyFileName, {
      validateKey: keyValidation({ access: expiredAccess, expired: true }),
      getPilotAccessValidator: () => validatePilotAccess
    })).resolves.toEqual({
      error: 'This pilot key expired on 2026-08-22, and Orbit could not confirm an active renewal. Connect this desktop to the internet, confirm the matching license is active, and try again.'
    });
  });

  it('rejects a renewed license whose account identity does not match the signed key', async () => {
    await expect(resolvePilotKeyImport({}, expiredAccess.keyFileName, {
      validateKey: keyValidation({ access: expiredAccess, expired: true }),
      getPilotAccessValidator: () => serverValidation({
        ok: true,
        managed: true,
        active: true,
        license: {
          accountKey: 'different-account',
          licenseId: 'different-account',
          status: 'active',
          expiresAt: '2099-10-01T23:59:59.999Z'
        }
      })
    })).resolves.toEqual({
      error: 'Orbit confirmed a renewal for a different pilot account. Use the key issued for this card house.'
    });
  });

  it('never contacts the server when local signature validation fails', async () => {
    const getPilotAccessValidator = vi.fn();

    await expect(resolvePilotKeyImport({}, expiredAccess.keyFileName, {
      validateKey: keyValidation({ error: 'License signature is invalid.' }),
      getPilotAccessValidator
    })).resolves.toEqual({ error: 'License signature is invalid.' });
    expect(getPilotAccessValidator).not.toHaveBeenCalled();
  });
});
