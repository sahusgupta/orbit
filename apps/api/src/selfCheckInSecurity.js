const crypto = require('crypto');

const clubAudience = 'orbit-club-self-check-in';
const playerAudience = 'orbit-player-self-check-in';
const tokenVersion = 'v1';
const minimumSecretLength = 32;
const maximumTokenLength = 4_096;
const maximumCapabilityLifetimeMs = 366 * 24 * 60 * 60 * 1000;
const maximumSessionLifetimeMs = 10 * 60 * 1000;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizePlayerName(value) {
  if (typeof value !== 'string') return null;
  let displayName;
  try {
    displayName = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  } catch {
    return null;
  }
  if (displayName.length < 2 || displayName.length > 80) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(displayName)) return null;
  if (!/\p{L}/u.test(displayName)) return null;
  if (!/^[\p{L}\p{M}\p{N}\p{Zs}.'\u2019,-]+$/u.test(displayName)) return null;
  return {
    displayName,
    lookupKey: displayName.toLocaleLowerCase('en-US')
  };
}

function validateMutationId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value);
}

function validateTableId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value);
}

function validateClubId(value) {
  return typeof value === 'string' && /^[a-z0-9._-]{1,96}$/.test(value);
}

function validateCapabilityGeneration(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value);
}

function createSelfCheckInSecurity(options = {}) {
  const secret = String(options.secret || '').trim();
  if (secret.length < minimumSecretLength) {
    throw new Error('ORBIT_SELF_CHECK_IN_SECRET must contain at least 32 characters.');
  }
  const nowMs = options.nowMs || Date.now;
  const randomUUID = options.randomUUID || crypto.randomUUID;

  function signPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const message = `${tokenVersion}.${body}`;
    const signature = crypto.createHmac('sha256', secret).update(message).digest('base64url');
    return `${message}.${signature}`;
  }

  function readPayload(token, audience) {
    if (typeof token !== 'string' || !token || token.length > maximumTokenLength) {
      return { ok: false, code: 'invalid' };
    }
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== tokenVersion || !parts[1] || !parts[2]) {
      return { ok: false, code: 'invalid' };
    }
    const message = `${parts[0]}.${parts[1]}`;
    const expected = crypto.createHmac('sha256', secret).update(message).digest('base64url');
    if (!safeEqual(parts[2], expected)) return { ok: false, code: 'invalid' };

    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      return { ok: false, code: 'invalid' };
    }
    if (
      !payload ||
      payload.aud !== audience ||
      !validateClubId(payload.club) ||
      !Number.isFinite(payload.iat) ||
      !Number.isFinite(payload.exp) ||
      payload.exp <= payload.iat ||
      payload.iat > nowMs() + 60_000 ||
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      payload.jti.length > 180
    ) {
      return { ok: false, code: 'invalid' };
    }
    if (payload.exp <= nowMs()) return { ok: false, code: 'expired' };
    return { ok: true, payload };
  }

  function issueClubCapability(input = {}) {
    const clubId = String(input.clubId || '').trim().toLowerCase();
    const generation = String(input.generation || '').trim();
    if (!validateClubId(clubId) || !validateCapabilityGeneration(generation)) {
      throw new Error('A valid club ID and capability generation are required.');
    }
    const issuedAt = nowMs();
    const requestedLifetime = Number(input.lifetimeMs || maximumCapabilityLifetimeMs);
    const lifetimeMs = Math.min(Math.max(requestedLifetime, 1_000), maximumCapabilityLifetimeMs);
    const requestedExpiration = Number(input.expiresAtMs);
    const expiresAt = Number.isFinite(requestedExpiration)
      ? Math.min(requestedExpiration, issuedAt + lifetimeMs)
      : issuedAt + lifetimeMs;
    if (expiresAt <= issuedAt) throw new Error('The club self-check-in capability has no valid lifetime.');
    const tokenId = String(randomUUID());
    return {
      token: signPayload({ aud: clubAudience, club: clubId, gen: generation, iat: issuedAt, exp: expiresAt, jti: tokenId }),
      expiresAt: new Date(expiresAt).toISOString(),
      tokenId
    };
  }

  function verifyClubCapability(token, options = {}) {
    const result = readPayload(token, clubAudience);
    if (!result.ok) return result;
    if (!validateCapabilityGeneration(result.payload.gen)) return { ok: false, code: 'invalid' };
    if (options.expectedGeneration && !safeEqual(result.payload.gen, options.expectedGeneration)) {
      return { ok: false, code: 'revoked' };
    }
    return {
      ok: true,
      value: {
        audience: clubAudience,
        clubId: result.payload.club,
        issuedAt: result.payload.iat,
        expiresAt: result.payload.exp,
        tokenId: result.payload.jti,
        generation: result.payload.gen
      }
    };
  }

  function issueScanSession(input = {}) {
    const clubId = String(input.clubId || '').trim().toLowerCase();
    const profileId = String(input.profileId || '').trim();
    const generation = String(input.generation || '').trim();
    if (!validateClubId(clubId) || !validateTableId(profileId) || !validateCapabilityGeneration(generation)) {
      throw new Error('A valid club, profile, and capability generation are required for self-check-in.');
    }
    const issuedAt = nowMs();
    const requestedLifetime = Number(input.lifetimeMs || 5 * 60 * 1000);
    const lifetimeMs = Math.min(Math.max(requestedLifetime, 1_000), maximumSessionLifetimeMs);
    const capabilityExpiration = Number(input.capabilityExpiresAt);
    const expiresAt = Number.isFinite(capabilityExpiration)
      ? Math.min(issuedAt + lifetimeMs, capabilityExpiration)
      : issuedAt + lifetimeMs;
    if (expiresAt <= issuedAt) throw new Error('The self-check-in session has no valid lifetime.');
    const tokenId = String(randomUUID());
    return {
      token: signPayload({
        aud: playerAudience,
        club: clubId,
        profile: profileId,
        gen: generation,
        iat: issuedAt,
        exp: expiresAt,
        jti: tokenId
      }),
      expiresAt: new Date(expiresAt).toISOString(),
      tokenId
    };
  }

  function verifyScanSession(token, options = {}) {
    const result = readPayload(token, playerAudience);
    if (!result.ok) return result;
    if (!validateTableId(result.payload.profile) || !validateCapabilityGeneration(result.payload.gen)) {
      return { ok: false, code: 'invalid' };
    }
    if (options.expectedGeneration && !safeEqual(result.payload.gen, options.expectedGeneration)) {
      return { ok: false, code: 'revoked' };
    }
    return {
      ok: true,
      value: {
        audience: playerAudience,
        clubId: result.payload.club,
        profileId: result.payload.profile,
        issuedAt: result.payload.iat,
        expiresAt: result.payload.exp,
        tokenId: result.payload.jti,
        generation: result.payload.gen
      }
    };
  }

  return {
    issueClubCapability,
    issueScanSession,
    verifyClubCapability,
    verifyScanSession
  };
}

module.exports = {
  createSelfCheckInSecurity,
  normalizePlayerName,
  safeEqual,
  validateMutationId,
  validateTableId
};
