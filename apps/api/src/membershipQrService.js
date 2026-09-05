const crypto = require('crypto');
const { loadState, saveState, schedulePublicationDrain } = require('./database');
const { sanitizeAccountKey } = require('./orbitCore');
const { protectedIdentifier } = require('./http/dataProtection');
const { logDomainChange } = require('./http/domainEvents');
const {
  getPublicIdentityStatus,
  normalizeRequiredMinimumAge,
  readIdentityRecord
} = require('./identityService');
const {
  createCurrentPlayerStatePrecondition,
  isPlayerStatePreconditionError,
  sendPlayerStatePreconditionError
} = require('./playerStatePrecondition');
const { inspectPlayerVenueRecord, sendPlayerVenueEligibilityError } = require('./playerVenueEligibility');

const membershipQrPrefix = 'omq1_';
const membershipQrPurpose = 'membership-check-in';
const defaultTtlMs = 2 * 60 * 1000;
const maximumRetainedTokens = 500;
const opaqueMutationPattern = /^[A-Za-z0-9_-]{16,180}$/;

class MembershipQrCommitBoundaryError extends Error {
  constructor(code) {
    super('The membership QR operation was no longer valid when it reached the authoritative state.');
    this.name = 'MembershipQrCommitBoundaryError';
    this.code = code || 'INVALID_MEMBERSHIP_QR';
  }
}

function readMembershipQrTime(readNowMs) {
  const value = Number(readNowMs());
  const date = new Date(value);
  if (!Number.isFinite(value) || !Number.isFinite(date.getTime())) {
    throw new MembershipQrCommitBoundaryError('PLAYER_TIME_UNAVAILABLE');
  }
  return value;
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function createMembershipQrSecurity(options = {}) {
  const secret = String(options.secret ?? process.env.ORBIT_MEMBERSHIP_QR_SECRET ?? '').trim();
  if (secret.length < 32) throw new Error('Membership QR signing is not configured.');
  const nowMs = options.nowMs || Date.now;
  const configuredTtl = Number(options.ttlMs || process.env.ORBIT_MEMBERSHIP_QR_TTL_MS || defaultTtlMs);
  const ttlMs = Math.min(Math.max(Number.isFinite(configuredTtl) ? configuredTtl : defaultTtlMs, 30_000), 5 * 60_000);

  function tokenFor({ clubId, playerId, mutationId }) {
    const value = crypto.createHmac('sha256', secret)
      .update(`membership-qr-token\u0000${clubId}\u0000${playerId}\u0000${mutationId}`)
      .digest('base64url');
    return `${membershipQrPrefix}${value}`;
  }

  function tokenId(token) {
    return crypto.createHmac('sha256', secret).update(`membership-qr-id\u0000${token}`).digest('hex');
  }

  function isToken(value) {
    return typeof value === 'string' && /^omq1_[A-Za-z0-9_-]{43}$/.test(value);
  }

  return { isToken, nowMs, tokenFor, tokenId, ttlMs };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseIssueRequest(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['clubId', 'mutationId'].includes(key))) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  const rawClubId = typeof body.clubId === 'string' ? body.clubId.trim() : '';
  const clubId = sanitizeAccountKey(rawClubId);
  const mutationId = typeof body.mutationId === 'string' ? body.mutationId.trim() : '';
  if (!clubId || rawClubId.toLowerCase() !== clubId || !opaqueMutationPattern.test(mutationId)) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  return { ok: true, value: { clubId, mutationId } };
}

function parseRedeemRequest(body, security) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !['token', 'mutationId'].includes(key))) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const mutationId = typeof body.mutationId === 'string' ? body.mutationId.trim() : '';
  if (!security.isToken(token) || !opaqueMutationPattern.test(mutationId)) {
    return { ok: false, code: 'INVALID_INPUT' };
  }
  return { ok: true, value: { token, mutationId } };
}

function findLinkedPlayerProfile(state, playerId) {
  const matches = (state.profiles || []).filter((profile) =>
    String(profile.id || '') === playerId || String(profile.orbitPlayerId || '') === playerId
  );
  if (matches.length === 1) return { ok: true, profile: matches[0] };
  return matches.length > 1
    ? { ok: false, code: 'PLAYER_LINK_AMBIGUOUS' }
    : { ok: false, code: 'PLAYER_NOT_FOUND' };
}

function isActiveMembership(profile, nowMs) {
  if (profile.membershipStatus !== 'Active') return false;
  const expiresAt = Date.parse(profile.membershipExpiresAt || profile.membershipExpirationDate || '');
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

function getMembershipQrIdentityEligibility(state, identityRecord, nowMs) {
  const minimumAge = normalizeRequiredMinimumAge(state?.settings?.clubAccount?.minimumPlayerAge);
  const now = new Date(nowMs);
  const identity = Number.isFinite(now.getTime())
    ? getPublicIdentityStatus(identityRecord, now)
    : getPublicIdentityStatus(identityRecord);
  return {
    ok: identity.ageEligible === true && identity.ageLevel >= minimumAge,
    ageLevel: identity.ageLevel,
    minimumAge
  };
}

function pruneMembershipQrTokens(tokens, nowMs) {
  return (tokens || [])
    .filter((token) => {
      const expiresAt = Date.parse(token.expiresAt || '');
      return Number.isFinite(expiresAt) && expiresAt + 10 * 60 * 1000 > nowMs;
    })
    .slice(-maximumRetainedTokens + 1);
}

function applyMembershipQrIssue(state, input, options) {
  const linked = findLinkedPlayerProfile(state, input.playerId);
  if (!linked.ok) return linked;
  if (!isActiveMembership(linked.profile, options.nowMs)) {
    return { ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' };
  }
  const existing = (state.membershipQrTokens || []).find((record) => record.id === input.tokenId);
  if (existing) {
    const sameSubject = existing.playerId === input.playerId && existing.clubId === input.clubId;
    if (!sameSubject || existing.purpose !== membershipQrPurpose) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    if (existing.status !== 'issued') return { ok: false, code: 'QR_REQUEST_ALREADY_COMPLETED' };
    return { ok: true, changed: false, tokenRecord: existing };
  }

  const issuedAt = new Date(options.nowMs).toISOString();
  const expiresAt = new Date(options.nowMs + options.ttlMs).toISOString();
  const retained = pruneMembershipQrTokens(state.membershipQrTokens, options.nowMs).map((record) =>
    record.playerId === input.playerId && record.clubId === input.clubId && record.status === 'issued'
      ? { ...record, status: 'superseded', supersededAt: issuedAt }
      : record
  );
  const tokenRecord = {
    id: input.tokenId,
    purpose: membershipQrPurpose,
    clubId: input.clubId,
    playerId: input.playerId,
    profileId: linked.profile.id,
    status: 'issued',
    issuedAt,
    expiresAt
  };
  return {
    ok: true,
    changed: true,
    tokenRecord,
    state: { ...state, membershipQrTokens: [...retained, tokenRecord] }
  };
}

const inactiveInterestStatuses = new Set(['Declined', 'No-Show', 'Left Before Seated', 'Removed']);

function applyMembershipArrival(state, profile, input) {
  const alreadySeated = (state.playerSessions || []).some((session) => session.profileId === profile.id && !session.leftAt);
  const activeInterest = (state.interests || []).find((interest) =>
    interest.profileId === profile.id && !inactiveInterestStatuses.has(interest.status)
  );
  if (alreadySeated || activeInterest?.status === 'Arrived' || activeInterest?.status === 'Seated') {
    return { ok: true, state, status: 'already-checked-in', playerName: profile.name };
  }
  const explicitInterestGameId = activeInterest && (state.games || []).some((game) => game.id === activeInterest.gameId)
    ? activeInterest.gameId
    : '';
  const preferredGameId = explicitInterestGameId || (profile.preferredGameIds || []).find((gameId) =>
    (state.games || []).some((game) => game.id === gameId)
  ) || ((state.games || []).some((game) => game.id === profile.preferredGameId) ? profile.preferredGameId : '');
  if (!preferredGameId) {
    return {
      ok: true,
      status: 'checked-in',
      playerName: profile.name,
      state: {
        ...state,
        playerLedger: [
          {
            id: `mqrl_${input.operationRef.slice(0, 32)}`,
            type: 'Check-In',
            profileId: profile.id,
            playerName: profile.name,
            timestamp: input.timestamp,
            note: 'Checked in with membership QR'
          },
          ...(state.playerLedger || [])
        ]
      }
    };
  }
  const interests = activeInterest
    ? state.interests.map((interest) => interest === activeInterest
      ? {
          ...interest,
          status: 'Arrived',
          timestamp: input.timestamp,
          arrivedAt: interest.arrivedAt || input.timestamp,
          notes: interest.notes || 'Checked in with membership QR'
        }
      : interest)
    : [
        ...(state.interests || []),
        {
          id: `mqri_${input.operationRef.slice(0, 32)}`,
          profileId: profile.id,
          playerName: profile.name,
          gameId: preferredGameId,
          status: 'Arrived',
          timestamp: input.timestamp,
          interestedAt: input.timestamp,
          arrivedAt: input.timestamp,
          notes: 'Checked in with membership QR'
        }
      ];
  return {
    ok: true,
    status: 'checked-in',
    playerName: profile.name,
    state: {
      ...state,
      interests,
      playerLedger: [
        {
          id: `mqrl_${input.operationRef.slice(0, 32)}`,
          type: 'Check-In',
          profileId: profile.id,
          playerName: profile.name,
          gameId: preferredGameId,
          timestamp: input.timestamp,
          note: 'Checked in with membership QR'
        },
        ...(state.playerLedger || [])
      ]
    }
  };
}

function applyMembershipQrRedemption(state, input, options) {
  const tokenRecord = (state.membershipQrTokens || []).find((record) => record.id === input.tokenId);
  if (!tokenRecord || tokenRecord.purpose !== membershipQrPurpose) return { ok: false, code: 'INVALID_MEMBERSHIP_QR' };
  if (tokenRecord.clubId !== input.clubId) return { ok: false, code: 'WRONG_VENUE' };
  if (tokenRecord.status === 'used') {
    if (safeEqual(tokenRecord.redemptionRef, input.redemptionRef)) {
      const linked = findLinkedPlayerProfile(state, tokenRecord.playerId);
      return linked.ok
        ? { ok: true, changed: false, status: tokenRecord.resultStatus || 'checked-in', playerName: linked.profile.name, tokenRecord }
        : linked;
    }
    return { ok: false, code: 'MEMBERSHIP_QR_ALREADY_USED' };
  }
  if (tokenRecord.status !== 'issued') return { ok: false, code: 'INVALID_MEMBERSHIP_QR' };
  const expiresAt = Date.parse(tokenRecord.expiresAt || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= options.nowMs) return { ok: false, code: 'MEMBERSHIP_QR_EXPIRED' };
  const identityEligibility = getMembershipQrIdentityEligibility(state, options.identityRecord, options.nowMs);
  if (!identityEligibility.ok) {
    return { ok: false, code: 'AGE_VERIFICATION_REQUIRED', minimumAge: identityEligibility.minimumAge };
  }
  const linked = findLinkedPlayerProfile(state, tokenRecord.playerId);
  if (!linked.ok) return linked;
  if (linked.profile.id !== tokenRecord.profileId) return { ok: false, code: 'PLAYER_NOT_FOUND' };
  if (!isActiveMembership(linked.profile, options.nowMs)) return { ok: false, code: 'MEMBERSHIP_NOT_ACTIVE' };
  const timestamp = new Date(options.nowMs).toISOString();
  const arrival = applyMembershipArrival(state, linked.profile, { timestamp, operationRef: input.redemptionRef });
  if (!arrival.ok) return arrival;
  const consumed = {
    ...tokenRecord,
    status: 'used',
    usedAt: timestamp,
    redemptionRef: input.redemptionRef,
    resultStatus: arrival.status
  };
  return {
    ok: true,
    changed: true,
    status: arrival.status,
    playerName: arrival.playerName,
    tokenRecord: consumed,
    state: {
      ...arrival.state,
      membershipQrTokens: state.membershipQrTokens.map((record) => record === tokenRecord ? consumed : record)
    }
  };
}

function sendMembershipQrError(response, code) {
  const errors = {
    PLAYER_NOT_FOUND: [404, 'No membership profile is linked to this player account.'],
    PLAYER_LINK_AMBIGUOUS: [409, 'This player account has conflicting membership links. Ask venue staff for help.'],
    MEMBERSHIP_NOT_ACTIVE: [403, 'An active, unexpired venue membership is required.'],
    IDEMPOTENCY_CONFLICT: [409, 'That request ID was already used for different membership QR details.'],
    QR_REQUEST_ALREADY_COMPLETED: [409, 'That QR request has already completed. Refresh to request a new code.'],
    INVALID_MEMBERSHIP_QR: [401, 'This membership QR is invalid.'],
    MEMBERSHIP_QR_EXPIRED: [410, 'This membership QR has expired. Ask the player to refresh it.'],
    MEMBERSHIP_QR_ALREADY_USED: [409, 'This membership QR has already been used.'],
    WRONG_VENUE: [403, 'This membership QR belongs to a different venue.'],
    AGE_VERIFICATION_REQUIRED: [403, 'The player must complete age verification for this venue before check-in.'],
    PLAYER_TIME_UNAVAILABLE: [503, 'The membership QR time could not be verified.'],
    IDEMPOTENCY_RECEIPT_STALE: [409, 'That request was already committed, but its QR result is no longer available. Refresh and use a new request ID.']
  };
  const [status, error] = errors[code] || [400, 'The membership QR request is invalid.'];
  response.status(status).json({ ok: false, code, error });
}

function requireMembershipQrRedeemer(request, response, next) {
  const scopes = Array.isArray(request.orbitAuth?.scopes) ? request.orbitAuth.scopes : [];
  if (!request.orbitAuth?.accountKey || !scopes.includes('client:write')) {
    response.status(403).json({
      ok: false,
      code: 'MEMBERSHIP_QR_REDEEM_FORBIDDEN',
      error: 'Tenant-scoped client write access is required.'
    });
    return;
  }
  next();
}

function createMembershipQrHandlers(dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const writeState = dependencies.saveState || saveState;
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const readIdentity = dependencies.readIdentityRecord || readIdentityRecord;
  const nowMs = dependencies.nowMs || Date.now;
  const preconditionNowMs = dependencies.preconditionNowMs || nowMs;
  const buildPlayerStatePrecondition = dependencies.createCurrentPlayerStatePrecondition
    || createCurrentPlayerStatePrecondition;

  function getSecurity() {
    return createMembershipQrSecurity({
      secret: dependencies.secret,
      ttlMs: dependencies.ttlMs,
      nowMs
    });
  }

  async function commit(accountKey, mutationId, mutationType, transform, options = {}) {
    let lastConflict;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const record = await readState(accountKey);
      if (!record?.state) return { kind: 'missing' };
      if (options.requireActiveVenue) {
        const eligibility = await inspectPlayerVenueRecord(record, dependencies);
        if (!eligibility.ok) return { kind: 'ineligible', eligibility };
      }
      const transition = await transform(record.state, options.initialNowMs, { transactionSecurityEvaluated: false });
      if (!transition.ok || !transition.changed) return { kind: 'unchanged', record, transition };
      try {
        const result = await writeState(transition.state, {
          expectedRevision: record.revision,
          mutationId,
          mutationType,
          transactionPrecondition: async (context) => {
            const commitNowMs = readMembershipQrTime(preconditionNowMs);
            const security = options.transactionPrecondition
              ? await options.transactionPrecondition({ ...context, commitNowMs })
              : undefined;
            const committedTransition = await transform(context.currentState, commitNowMs, {
              transactionSecurityEvaluated: Boolean(options.transactionPrecondition),
              security
            });
            if (!committedTransition.ok) {
              throw new MembershipQrCommitBoundaryError(committedTransition.code);
            }
            return {
              nextState: committedTransition.state || context.currentState,
              result: { transition: committedTransition }
            };
          }
        });
        if (result.duplicate) {
          const current = await readState(accountKey);
          if (!current?.state) throw new Error('Membership QR state was unavailable after an idempotent replay.');
          const replay = await transform(current.state, readMembershipQrTime(nowMs), {
            transactionSecurityEvaluated: false
          });
          if (!replay.ok || replay.changed) {
            return { kind: 'duplicate', record: current, transition: { ok: false, code: 'IDEMPOTENCY_RECEIPT_STALE' }, result };
          }
          return { kind: 'duplicate', record: current, transition: replay, result };
        }
        return {
          kind: 'saved',
          record,
          transition: result.transactionResult?.transition || transition,
          result
        };
      } catch (error) {
        if (error?.name === 'MembershipQrCommitBoundaryError') {
          return { kind: 'commit-boundary', transition: { ok: false, code: error.code }, error };
        }
        if (isPlayerStatePreconditionError(error)) return { kind: 'precondition', error };
        if (error?.code !== 'STATE_REVISION_CONFLICT') throw error;
        lastConflict = error;
      }
    }
    throw lastConflict || new Error('Membership QR state could not commit after bounded retries.');
  }

  async function issue(request, response) {
    response.set('cache-control', 'private, no-store');
    let security;
    try {
      security = getSecurity();
    } catch {
      response.status(503).json({ ok: false, code: 'MEMBERSHIP_QR_NOT_CONFIGURED', error: 'Membership QR signing is unavailable.' });
      return;
    }
    const parsed = parseIssueRequest(request.body);
    if (!parsed.ok) {
      response.status(400).json({ ok: false, code: parsed.code, error: 'A valid venue and opaque request ID are required.' });
      return;
    }
    const playerId = String(request.orbitPlayer?.uid || '');
    const token = security.tokenFor({ ...parsed.value, playerId });
    const tokenId = security.tokenId(token);
    let issuedAtMs;
    try {
      issuedAtMs = readMembershipQrTime(nowMs);
    } catch (error) {
      sendMembershipQrError(response, error.code);
      return;
    }
    const mutationId = `membership-qr-issue:${sha256(`${parsed.value.clubId}\u0000${playerId}\u0000${parsed.value.mutationId}`)}`;
    const committed = await commit(parsed.value.clubId, mutationId, 'membership-qr-issued', (state, effectiveNowMs) =>
      applyMembershipQrIssue(state, { clubId: parsed.value.clubId, playerId, tokenId }, {
        nowMs: effectiveNowMs,
        ttlMs: security.ttlMs
      }),
      {
        initialNowMs: issuedAtMs,
        requireActiveVenue: true,
        transactionPrecondition: buildPlayerStatePrecondition({
          playerId,
          nowMs: preconditionNowMs,
          returnSecurityContext: true
        })
      }
    );
    if (committed.kind === 'missing') {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The selected Orbit club is unavailable.' });
      return;
    }
    if (committed.kind === 'ineligible') {
      sendPlayerVenueEligibilityError(response, committed.eligibility);
      return;
    }
    if (committed.kind === 'precondition') {
      sendPlayerStatePreconditionError(response, committed.error);
      return;
    }
    if (committed.kind === 'commit-boundary') {
      sendMembershipQrError(response, committed.transition.code);
      return;
    }
    if (!committed.transition.ok) {
      sendMembershipQrError(response, committed.transition.code);
      return;
    }
    if (committed.kind === 'saved') {
      logDomainChange('membership-qr-issued', {
        tenantRef: protectedIdentifier(parsed.value.clubId),
        subjectRef: protectedIdentifier(playerId),
        tokenRef: tokenId.slice(0, 16)
      });
      void drain();
    }
    response.status(committed.kind === 'saved' ? 201 : 200).json({
      ok: true,
      token,
      issuedAt: committed.transition.tokenRecord.issuedAt,
      expiresAt: committed.transition.tokenRecord.expiresAt
    });
  }

  async function redeem(request, response) {
    response.set('cache-control', 'private, no-store');
    let security;
    try {
      security = getSecurity();
    } catch {
      response.status(503).json({ ok: false, code: 'MEMBERSHIP_QR_NOT_CONFIGURED', error: 'Membership QR validation is unavailable.' });
      return;
    }
    const parsed = parseRedeemRequest(request.body, security);
    if (!parsed.ok) {
      response.status(400).json({ ok: false, code: parsed.code, error: 'A valid membership QR and opaque request ID are required.' });
      return;
    }
    const accountKey = sanitizeAccountKey(request.orbitAuth.accountKey);
    const tokenId = security.tokenId(parsed.value.token);
    const redeemerId = String(request.orbitAuth.credentialId || request.orbitAuth.type || 'venue-client');
    const redemptionRef = sha256(`${accountKey}\u0000${redeemerId}\u0000${parsed.value.mutationId}`);
    let redeemedAtMs;
    try {
      redeemedAtMs = readMembershipQrTime(nowMs);
    } catch (error) {
      sendMembershipQrError(response, error.code);
      return;
    }
    const mutationId = `membership-qr-redeem:${sha256(`${tokenId}\u0000${redemptionRef}`)}`;
    const committed = await commit(accountKey, mutationId, 'membership-qr-redeemed', async (state, effectiveNowMs, commitContext) => {
      const tokenRecord = (state.membershipQrTokens || []).find((record) =>
        record.id === tokenId
        && record.purpose === membershipQrPurpose
        && record.clubId === accountKey
        && record.status === 'issued'
      );
      const identityRecord = commitContext?.transactionSecurityEvaluated
        ? commitContext.security?.identityRecord
        : tokenRecord ? await readIdentity(tokenRecord.playerId) : undefined;
      return applyMembershipQrRedemption(
        state,
        { clubId: accountKey, tokenId, redemptionRef },
        { nowMs: effectiveNowMs, identityRecord }
      );
    }, {
      initialNowMs: redeemedAtMs,
      requireActiveVenue: true,
      transactionPrecondition: async (context) => {
        const { currentState } = context;
        const tokenRecord = (currentState?.membershipQrTokens || []).find((record) =>
          record.id === tokenId
          && record.purpose === membershipQrPurpose
          && record.clubId === accountKey
          && record.status === 'issued'
        );
        if (!tokenRecord) return;
        return buildPlayerStatePrecondition({
          playerId: tokenRecord.playerId,
          nowMs: preconditionNowMs,
          returnSecurityContext: true
        })(context);
      }
    });
    if (committed.kind === 'missing') {
      response.status(404).json({ ok: false, code: 'CLUB_NOT_FOUND', error: 'The authenticated Orbit club is unavailable.' });
      return;
    }
    if (committed.kind === 'ineligible') {
      sendPlayerVenueEligibilityError(response, committed.eligibility);
      return;
    }
    if (committed.kind === 'precondition') {
      sendPlayerStatePreconditionError(response, committed.error);
      return;
    }
    if (committed.kind === 'commit-boundary') {
      sendMembershipQrError(response, committed.transition.code);
      return;
    }
    if (!committed.transition.ok) {
      sendMembershipQrError(response, committed.transition.code);
      return;
    }
    if (committed.kind === 'saved') {
      logDomainChange('membership-qr-redeemed', {
        tenantRef: protectedIdentifier(accountKey),
        tokenRef: tokenId.slice(0, 16),
        status: committed.transition.status
      });
      void drain();
    }
    response.status(committed.kind === 'saved' ? 201 : 200).json({
      ok: true,
      status: committed.transition.status,
      playerName: committed.transition.playerName,
      expiresAt: committed.transition.tokenRecord.expiresAt,
      duplicate: committed.kind !== 'saved'
    });
  }

  return { issue, redeem };
}

module.exports = {
  applyMembershipArrival,
  applyMembershipQrIssue,
  applyMembershipQrRedemption,
  createMembershipQrHandlers,
  createMembershipQrSecurity,
  findLinkedPlayerProfile,
  getMembershipQrIdentityEligibility,
  isActiveMembership,
  membershipQrPrefix,
  parseIssueRequest,
  parseRedeemRequest,
  requireMembershipQrRedeemer
};
