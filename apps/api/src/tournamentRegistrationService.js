const crypto = require('crypto');
const { getAccountKeyFromState } = require('./orbitCore');
const { interestWindow } = require('./tournamentInterestService');

// Launch registrations must never create a paid entry, rebuy, add-on, or debt.
function isNoPaymentTournament(tournament) {
  return tournament?.buyIn === 0
    && isFreeExtraEntry(tournament.rebuysAllowed, tournament.rebuyPrice)
    && isFreeExtraEntry(tournament.addOnsAllowed, tournament.addOnPrice);
}

function isFreeExtraEntry(enabled, price) {
  // The persisted management model uses optional flags; only true enables one.
  return enabled === undefined || enabled === false || enabled === true && price === 0;
}

function playerProfileIds(state, playerId) {
  return new Set([playerId, ...(state.profiles || [])
    .filter((profile) => profile.id === playerId || profile.orbitPlayerId === playerId)
    .map((profile) => profile.id)]);
}

function findPlayerTournamentEntry(state, tournament, playerId) {
  const profileIds = playerProfileIds(state, playerId);
  return (tournament.players || []).find((entry) => profileIds.has(entry.profileId));
}

function projectPlayerRegistration(entry, clubId, tournamentId, playerId) {
  if (!entry || !entry.id || !Number.isFinite(Date.parse(entry.registeredAt || ''))) return undefined;
  return {
    id: entry.registrationId || entry.id,
    clubId,
    tournamentId,
    playerId,
    status: 'registered',
    registeredAt: entry.registeredAt
  };
}

function buildPlayerTournamentRegistration(state, clubId, tournamentId, playerId) {
  if (!playerId || getAccountKeyFromState(state) !== clubId) return undefined;
  const tournament = (state.tournaments || []).find((candidate) => candidate.id === tournamentId);
  return tournament && projectPlayerRegistration(findPlayerTournamentEntry(state, tournament, playerId), clubId, tournamentId, playerId);
}

function applyTournamentRegistration(state, input, options = {}) {
  if (getAccountKeyFromState(state) !== input.clubId) return { ok: false, code: 'CLUB_NOT_FOUND' };
  const tournament = (state.tournaments || []).find((candidate) => candidate.id === input.tournamentId);
  if (!tournament) return { ok: false, code: 'TOURNAMENT_NOT_FOUND' };
  if (!isNoPaymentTournament(tournament)) return { ok: false, code: 'PLAYER_TOURNAMENT_PAYMENT_NOT_SUPPORTED' };
  const window = interestWindow(tournament, options.nowMs);
  if (!window.open || Date.parse(tournament.registrationClosesAt) > Date.parse(tournament.scheduledAt || tournament.startedAt)) {
    return { ok: false, code: 'TOURNAMENT_REGISTRATION_CLOSED' };
  }
  const existing = findPlayerTournamentEntry(state, tournament, input.player.id);
  if (existing) {
    const registration = projectPlayerRegistration(existing, input.clubId, input.tournamentId, input.player.id);
    return registration
      ? { ok: true, state, registration, changed: false }
      : { ok: false, code: 'TOURNAMENT_REGISTRATION_UNAVAILABLE' };
  }
  if (typeof tournament.startingStack !== 'number' || !Number.isFinite(tournament.startingStack) || tournament.startingStack < 0) {
    return { ok: false, code: 'TOURNAMENT_REGISTRATION_UNAVAILABLE' };
  }
  const profile = (state.profiles || []).find((candidate) => candidate.id === input.player.id || candidate.orbitPlayerId === input.player.id);
  const timestamp = new Date(options.nowMs ?? Date.now()).toISOString();
  const entryId = options.entryId || `tr_${crypto.randomUUID()}`;
  const entry = {
    id: entryId,
    registrationId: entryId,
    profileId: profile?.id || input.player.id,
    name: String(profile?.name || input.player.name || 'Player').trim(),
    ...(input.player.email ? { email: input.player.email } : {}),
    ...(input.player.phone ? { phone: input.player.phone } : {}),
    buyIn: 0,
    rebuys: 0,
    addOns: 0,
    startingStack: tournament.startingStack,
    status: 'Registered',
    registeredAt: timestamp
  };
  return {
    ok: true,
    changed: true,
    registration: projectPlayerRegistration(entry, input.clubId, input.tournamentId, input.player.id),
    state: { ...state, tournaments: state.tournaments.map((candidate) => candidate === tournament
      ? { ...candidate, players: [...(candidate.players || []), entry] } : candidate) }
  };
}

module.exports = { applyTournamentRegistration, buildPlayerTournamentRegistration, isNoPaymentTournament };
