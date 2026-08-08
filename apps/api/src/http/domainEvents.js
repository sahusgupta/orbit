function logDomainChange(event, details = {}) {
  console.log(`[orbit-api] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    event,
    ...details
  })}`);
}

function logStateChanges(previousState, nextState, accountKey) {
  if (!previousState) {
    logDomainChange('core-connected', { accountKey });
    return;
  }
  const previousProfiles = new Map((previousState.profiles || []).map((profile) => [profile.id, profile]));
  const previousSessions = new Map((previousState.sessions || []).map((session) => [session.id, session]));
  const previousInterests = new Set((previousState.interests || []).map((interest) => interest.id));

  for (const profile of nextState.profiles || []) {
    const previous = previousProfiles.get(profile.id);
    if (!previous) {
      logDomainChange('player-added', { accountKey, playerId: profile.id, playerName: profile.name || 'Player' });
    } else if (previous.membershipStatus !== profile.membershipStatus) {
      logDomainChange('membership-status-changed', {
        accountKey,
        playerId: profile.id,
        playerName: profile.name || 'Player',
        from: previous.membershipStatus || 'None',
        to: profile.membershipStatus || 'None'
      });
    }
  }

  for (const session of nextState.sessions || []) {
    const previous = previousSessions.get(session.id);
    if (!previous) {
      logDomainChange('game-formed', {
        accountKey,
        sessionId: session.id,
        gameId: session.gameId,
        table: session.label || '',
        status: session.status || ''
      });
    } else if (previous.status !== session.status) {
      logDomainChange('game-status-changed', {
        accountKey,
        sessionId: session.id,
        gameId: session.gameId,
        table: session.label || '',
        from: previous.status || '',
        to: session.status || ''
      });
    }
  }

  for (const interest of nextState.interests || []) {
    if (!previousInterests.has(interest.id)) {
      logDomainChange('game-request-added', {
        accountKey,
        requestId: interest.id,
        playerId: interest.profileId || '',
        playerName: interest.playerName || 'Player',
        gameId: interest.gameId,
        status: interest.status || ''
      });
    }
  }
}

module.exports = {
  logDomainChange,
  logStateChanges
};
