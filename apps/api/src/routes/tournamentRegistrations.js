const crypto = require('crypto');
const { loadState, loadGlobalMutationReceipt, saveState, schedulePublicationDrain } = require('../database');
const { trustedPlayerFromClaims } = require('../playerRequestSecurity');
const { parseTournamentInterestRequest } = require('../tournamentInterestService');
const { applyTournamentRegistration } = require('../tournamentRegistrationService');
const { inspectPlayerVenueRecord, sendPlayerVenueEligibilityError } = require('../playerVenueEligibility');
const { createCurrentPlayerStatePrecondition, isPlayerStatePreconditionError, sendPlayerStatePreconditionError } = require('../playerStatePrecondition');

const errors = {
  CLUB_NOT_FOUND: [404, 'The selected Orbit club is unavailable.'],
  TOURNAMENT_NOT_FOUND: [404, 'Tournament not found.'],
  PLAYER_TOURNAMENT_PAYMENT_NOT_SUPPORTED: [409, 'Only events with no entry, rebuy, or add-on payment can be registered in Orbit. Express interest in other events.'],
  TOURNAMENT_REGISTRATION_CLOSED: [409, 'Registration for this event is closed.'],
  TOURNAMENT_REGISTRATION_UNAVAILABLE: [409, 'Registration is unavailable. Contact the venue.'],
  MUTATION_ID_REUSED: [409, 'That request ID was already used for a different registration.'],
  IDEMPOTENCY_RECEIPT_STALE: [409, 'The original registration result is unavailable. Refresh your events before retrying.'],
  PLAYER_TIME_UNAVAILABLE: [503, 'The request time could not be verified.']
};

function sendError(response, code) {
  const [status, error] = errors[code] || [409, 'Registration could not be saved.'];
  response.status(status).json({ ok: false, code, error });
}

function readTime(nowMs) {
  const value = Number(nowMs());
  if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) {
    throw Object.assign(new Error('The request time could not be verified.'), {
      registrationCode: 'PLAYER_TIME_UNAVAILABLE'
    });
  }
  return value;
}

function createTournamentRegistrationHandler(dependencies = {}) {
  const readState = dependencies.loadState || loadState;
  const readReceipt = dependencies.loadGlobalMutationReceipt || loadGlobalMutationReceipt;
  const writeState = dependencies.saveState || saveState;
  const drain = dependencies.schedulePublicationDrain || schedulePublicationDrain;
  const nowMs = dependencies.nowMs || Date.now;
  const commitNowMs = dependencies.preconditionNowMs || Date.now;
  const buildSecurity = dependencies.createCurrentPlayerStatePrecondition || createCurrentPlayerStatePrecondition;
  return async function handleTournamentRegistration(request, response) {
    const parsed = parseTournamentInterestRequest(request.body);
    if (!parsed.ok) {
      response.status(400).json({ ok: false, code: parsed.code, error: parsed.error });
      return;
    }
    const player = trustedPlayerFromClaims(request.orbitPlayer);
    if (!player.id) {
      response.status(401).json({ ok: false, error: 'Firebase player sign-in is required.' });
      return;
    }
    const input = { ...parsed.value, player };
    const receiptResult = (registration) => ({
      registrationId: registration.id, status: registration.status, registeredAt: registration.registeredAt
    });
    const restoreRegistration = (result) => result?.registrationId && result.status === 'registered'
      && Number.isFinite(Date.parse(result.registeredAt || ''))
      ? { id: result.registrationId, status: result.status, registeredAt: result.registeredAt,
          clubId: input.clubId, tournamentId: input.tournamentId, playerId: player.id }
      : null;
    const receiptId = `tournament-registration:${crypto.createHash('sha256').update(`${player.id}\u0000${input.mutationId}`).digest('hex')}`;
    const fingerprint = `${input.clubId}\u0000${input.tournamentId}`;
    const fingerprintRef = crypto.createHash('sha256').update(fingerprint).digest('hex');
    const entryId = `tr_${(dependencies.randomUUID || crypto.randomUUID)()}`;
    const reply = (result, registration, status = 200) => response.status(status).json({
      ok: true, accountKey: result.accountKey, savedAt: result.savedAt || result.createdAt,
      revision: Number(result.revision), registration
    });
    try {
      const acceptedAtMs = readTime(nowMs);
      let record = await readState(input.clubId);
      if (!record?.state) return sendError(response, 'CLUB_NOT_FOUND');
      const eligibility = await inspectPlayerVenueRecord(record, dependencies);
      if (!eligibility.ok) return sendPlayerVenueEligibilityError(response, eligibility);
      const existingReceipt = await readReceipt(receiptId);
      if (existingReceipt) {
        if (existingReceipt.fingerprintRef !== fingerprintRef) return sendError(response, 'MUTATION_ID_REUSED');
        const registration = restoreRegistration(existingReceipt.result);
        if (!registration) return sendError(response, 'IDEMPOTENCY_RECEIPT_STALE');
        return reply(existingReceipt, registration);
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt) record = await readState(input.clubId);
        if (!record?.state) return sendError(response, 'CLUB_NOT_FOUND');
        const transition = applyTournamentRegistration(record.state, input, { entryId, nowMs: acceptedAtMs });
        if (!transition.ok) return sendError(response, transition.code);
        const security = buildSecurity({ playerId: player.id, nowMs: commitNowMs });
        try {
          const result = await writeState(transition.state, {
            expectedRevision: record.revision,
            mutationId: receiptId,
            mutationType: 'player-tournament-registration',
            globalMutationScope: receiptId,
            globalMutationFingerprint: fingerprint,
            globalMutationResult: receiptResult(transition.registration),
            transactionPrecondition: async (context) => {
              const timestampMs = readTime(commitNowMs);
              await security({ ...context, commitNowMs: timestampMs });
              const committed = applyTournamentRegistration(context.currentState, input, { entryId, nowMs: timestampMs });
              if (!committed.ok) {
                throw Object.assign(new Error('The event is no longer available for registration.'), {
                  registrationCode: committed.code
                });
              }
              return { nextState: committed.state, result: {
                transition: committed, globalMutationResult: receiptResult(committed.registration)
              } };
            }
          });
          if (result.duplicate) {
            const registration = restoreRegistration(result.idempotencyResult);
            if (!registration) return sendError(response, 'IDEMPOTENCY_RECEIPT_STALE');
            return reply(result, registration);
          }
          const committed = result.transactionResult?.transition || transition;
          void drain();
          return reply(result, committed.registration, committed.changed ? 201 : 200);
        } catch (error) {
          if (error?.code === 'IDEMPOTENCY_CONFLICT') return sendError(response, 'MUTATION_ID_REUSED');
          if (error?.code !== 'STATE_REVISION_CONFLICT' || attempt === 3) throw error;
        }
      }
    } catch (error) {
      if (error?.registrationCode) return sendError(response, error.registrationCode);
      if (isPlayerStatePreconditionError(error)) return sendPlayerStatePreconditionError(response, error);
      throw error;
    }
  };
}

module.exports = { createTournamentRegistrationHandler };
