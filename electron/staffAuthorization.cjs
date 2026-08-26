const crypto = require('crypto');

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPin(pin, salt, storedHash) {
  if (!/^\d{4,12}$/.test(String(pin || ''))) return false;
  if (String(storedHash || '').startsWith('pbkdf2-sha256$')) {
    const [, iterationsValue, expected] = storedHash.split('$');
    const iterations = Number(iterationsValue);
    if (!Number.isInteger(iterations) || iterations < 100_000 || !/^[a-f0-9]{64}$/i.test(expected || '')) return false;
    const actual = crypto.pbkdf2Sync(String(pin), String(salt), iterations, 32, 'sha256').toString('hex');
    return safeEqual(actual, expected);
  }
  const legacy = crypto.createHash('sha256').update(`${salt}:${pin}`).digest('hex');
  return safeEqual(legacy, storedHash);
}

function createStaffAuthorization(dependencies) {
  const now = dependencies.now || Date.now;
  const loadStateForAccess = dependencies.loadStateForAccess;
  const sessions = new Map();
  const attempts = new Map();

  async function activate(input) {
    const staffId = String(input?.staffId || '').trim();
    const pin = String(input?.pin || '').trim();
    if (!staffId || !/^\d{4,12}$/.test(pin) || !input?.access) {
      return { ok: false, error: 'Staff verification failed.' };
    }
    const attemptKey = `${String(input.access.licenseId || input.access.authorizationCode || '')}:${staffId}`;
    const prior = attempts.get(attemptKey) || { failures: 0, lockedUntil: 0 };
    if (prior.lockedUntil > now()) return { ok: false, error: 'Staff verification is temporarily locked.' };

    let record;
    try {
      record = await loadStateForAccess(input.access);
    } catch {
      return { ok: false, error: 'Authoritative staff verification is temporarily unavailable.' };
    }
    if (!record?.authoritative) {
      return { ok: false, error: 'Authoritative staff verification is temporarily unavailable.' };
    }
    const staff = record?.state?.settings?.staffAccounts?.find((candidate) => candidate.id === staffId && candidate.active !== false);
    if (!staff) return { ok: false, error: 'Staff verification failed.' };
    if (!verifyPin(pin, staff.pinSalt, staff.pinHash)) {
      const failures = prior.failures + 1;
      attempts.set(attemptKey, {
        failures: failures >= 5 ? 0 : failures,
        lockedUntil: failures >= 5 ? now() + 5 * 60_000 : 0
      });
      return { ok: false, error: failures >= 5 ? 'Staff verification is temporarily locked.' : 'Staff verification failed.' };
    }

    attempts.delete(attemptKey);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = now() + 15 * 60_000;
    sessions.set(token, { staffId: staff.id, role: staff.role, accountKey: record.accountKey, expiresAt });
    return {
      ok: true,
      token,
      staffId: staff.id,
      role: staff.role,
      accountKey: record.accountKey,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  function authorize(input) {
    const token = String(input?.token || '');
    const session = sessions.get(token);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(token);
      return { ok: false, error: 'Staff reauthentication is required.', reauthenticate: true };
    }
    const action = String(input?.action || '');
    const allowed = action === 'staff-sign'
      || (['manager-lock', 'manager-reopen', 'staff-admin', 'send-text-messages'].includes(action)
        && ['Owner', 'Manager'].includes(session.role));
    if (!allowed) {
      return {
        ok: false,
        error: 'Select and verify an Owner or Manager for this action.',
        reauthenticate: false
      };
    }
    return { ok: true, staffId: session.staffId, role: session.role, accountKey: session.accountKey };
  }

  return { activate, authorize, verifyPin };
}

module.exports = { createStaffAuthorization, verifyPin };
