const { enforcePlayerPrivacyTombstones } = require('./accountDeletionService');

function preserveServerManagedState(incomingState, authoritativeState) {
  let state = { ...incomingState };
  if (authoritativeState?.selfCheckIn) state.selfCheckIn = authoritativeState.selfCheckIn;
  else delete state.selfCheckIn;
  for (const key of ['membershipQrTokens', 'playerPrivacyTombstones', 'tournamentInterests']) {
    if (authoritativeState && Object.hasOwn(authoritativeState, key)) state[key] = authoritativeState[key];
    else delete state[key];
  }
  state = enforcePlayerPrivacyTombstones(state, authoritativeState);
  return state;
}

module.exports = { preserveServerManagedState };
