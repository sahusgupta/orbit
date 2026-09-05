const crypto = require('crypto');
const { sanitizeAccountKey } = require('./orbitCore');

const tournamentInterestStatuses = new Set(['interested', 'withdrawn']);
const maximumIdentifierLength = 180;
const opaqueMutationPattern = /^[A-Za-z0-9_-]{16,180}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, allowedKeys) {
  return isPlainObject(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function parseTournamentInterestRequest(body) {
  if (!hasExactKeys(body, ['clubId', 'tournamentId', 'mutationId'])) {
    return { ok: false, code: 'INVALID_INPUT', error: 'The request contains unsupported fields.' };
  }
  const rawClubId = typeof body.clubId === 'string' ? body.clubId.trim() : '';
  const clubId = sanitizeAccountKey(rawClubId);
  const tournamentId = typeof body.tournamentId === 'string' ? body.tournamentId.trim() : '';
  const mutationId = typeof body.mutationId === 'string' ? body.mutationId.trim() : '';
  if (
    !clubId || clubId !== rawClubId.toLowerCase() ||
    !tournamentId || tournamentId.length > maximumIdentifierLength || /[\u0000-\u001f/\\]/.test(tournamentId) ||
    !opaqueMutationPattern.test(mutationId)
  ) {
    return { ok: false, code: 'INVALID_INPUT', error: 'A valid club, tournament, and opaque request ID are required.' };
  }
  return { ok: true, value: { clubId, tournamentId, mutationId } };
}

function interestWindow(tournament, nowMs = Date.now()) {
  const opensAt = Date.parse(tournament.registrationOpensAt || '');
  const closesAt = Date.parse(tournament.registrationClosesAt || '');
  const startsAt = Date.parse(tournament.scheduledAt || tournament.startedAt || '');
  if (
    tournament.status !== 'Draft' ||
    tournament.registrationStatus !== 'open' ||
    !Number.isFinite(opensAt) ||
    !Number.isFinite(closesAt) ||
    !Number.isFinite(startsAt) ||
    opensAt >= closesAt
  ) {
    return { open: false, code: 'TOURNAMENT_INTEREST_CLOSED' };
  }
  if (Number.isFinite(opensAt) && nowMs < opensAt) {
    return { open: false, code: 'TOURNAMENT_INTEREST_NOT_OPEN' };
  }
  if (nowMs >= closesAt || nowMs >= startsAt) {
    return { open: false, code: 'TOURNAMENT_INTEREST_CLOSED' };
  }
  return { open: true };
}

function findTournamentInterest(state, clubId, tournamentId, playerId) {
  return (state.tournamentInterests || []).find((interest) =>
    interest.clubId === clubId &&
    interest.tournamentId === tournamentId &&
    interest.playerId === playerId &&
    tournamentInterestStatuses.has(interest.status)
  );
}

function buildPlayerTournamentInterests(state, clubId, playerId) {
  if (!playerId) return [];
  return (state.tournamentInterests || []).flatMap((interest) => {
    const createdAt = typeof interest?.createdAt === 'string' ? interest.createdAt : '';
    const updatedAt = typeof interest?.updatedAt === 'string' ? interest.updatedAt : '';
    const withdrawnAt = typeof interest?.withdrawnAt === 'string' ? interest.withdrawnAt : '';
    if (
      interest?.clubId !== clubId ||
      interest?.playerId !== playerId ||
      typeof interest.id !== 'string' ||
      typeof interest.tournamentId !== 'string' ||
      !tournamentInterestStatuses.has(interest.status) ||
      !Number.isFinite(Date.parse(createdAt)) ||
      !Number.isFinite(Date.parse(updatedAt)) ||
      (withdrawnAt && !Number.isFinite(Date.parse(withdrawnAt)))
    ) return [];
    return [{
      id: interest.id,
      tournamentId: interest.tournamentId,
      clubId,
      playerId,
      status: interest.status,
      createdAt,
      updatedAt,
      ...(withdrawnAt ? { withdrawnAt } : {})
    }];
  });
}

function createTournamentInterestId(createId = crypto.randomUUID) {
  return `ti_${createId().replace(/[^A-Za-z0-9_-]/g, '')}`;
}

function applyTournamentInterestTransition(state, input, options = {}) {
  const tournament = (state.tournaments || []).find((candidate) => candidate.id === input.tournamentId);
  if (!tournament) return { ok: false, code: 'TOURNAMENT_NOT_FOUND' };
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const now = options.now || new Date(nowMs).toISOString();
  const existing = findTournamentInterest(state, input.clubId, input.tournamentId, input.playerId);

  if (input.action === 'express') {
    const window = interestWindow(tournament, nowMs);
    if (!window.open) return { ok: false, code: window.code };
    if (existing?.status === 'interested') return { ok: true, state, interest: existing, changed: false };
    const interest = existing
      ? (() => {
          const { withdrawnAt: _withdrawnAt, ...retained } = existing;
          return { ...retained, status: 'interested', updatedAt: now };
        })()
      : {
          id: options.interestId || createTournamentInterestId(options.createId),
          tournamentId: input.tournamentId,
          clubId: input.clubId,
          playerId: input.playerId,
          status: 'interested',
          createdAt: now,
          updatedAt: now
        };
    return {
      ok: true,
      changed: true,
      interest,
      state: {
        ...state,
        tournamentInterests: existing
          ? (state.tournamentInterests || []).map((candidate) => candidate === existing ? interest : candidate)
          : [...(state.tournamentInterests || []), interest]
      }
    };
  }

  if (!existing) return { ok: false, code: 'TOURNAMENT_INTEREST_NOT_FOUND' };
  if (existing.status === 'withdrawn') return { ok: true, state, interest: existing, changed: false };
  const startsAt = Date.parse(tournament.scheduledAt || tournament.startedAt || '');
  if (
    tournament.status !== 'Draft'
    || tournament.unregisterAllowed !== true
    || !Number.isFinite(startsAt)
    || nowMs >= startsAt
  ) {
    return { ok: false, code: 'TOURNAMENT_INTEREST_WITHDRAWAL_CLOSED' };
  }
  const interest = { ...existing, status: 'withdrawn', updatedAt: now, withdrawnAt: now };
  return {
    ok: true,
    changed: true,
    interest,
    state: {
      ...state,
      tournamentInterests: (state.tournamentInterests || []).map((candidate) => candidate === existing ? interest : candidate)
    }
  };
}

module.exports = {
  applyTournamentInterestTransition,
  buildPlayerTournamentInterests,
  createTournamentInterestId,
  findTournamentInterest,
  interestWindow,
  parseTournamentInterestRequest,
  tournamentInterestStatuses
};
