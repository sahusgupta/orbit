const { protectedIdentifier, redactDetails } = require('./dataProtection');

function logDomainChange(event, details = {}) {
  console.log(`[orbit-api] ${JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    event,
    ...redactDetails(details)
  })}`);
}

function logStateChanges(previousState, nextState, accountKey) {
  if (!previousState) {
    logDomainChange('core-connected', { tenantRef: protectedIdentifier(accountKey) });
    return;
  }
  const previousProfiles = new Map((previousState.profiles || []).map((profile) => [profile.id, profile]));
  const previousSessions = new Map((previousState.sessions || []).map((session) => [session.id, session]));
  const previousInterests = new Set((previousState.interests || []).map((interest) => interest.id));

  for (const profile of nextState.profiles || []) {
    const previous = previousProfiles.get(profile.id);
    if (!previous) {
      logDomainChange('player-added', { tenantRef: protectedIdentifier(accountKey), subjectRef: protectedIdentifier(profile.id) });
    } else if (previous.membershipStatus !== profile.membershipStatus) {
      logDomainChange('membership-status-changed', {
        tenantRef: protectedIdentifier(accountKey),
        subjectRef: protectedIdentifier(profile.id),
        from: previous.membershipStatus || 'None',
        to: profile.membershipStatus || 'None'
      });
    }
  }

  for (const session of nextState.sessions || []) {
    const previous = previousSessions.get(session.id);
    if (!previous) {
      logDomainChange('game-formed', {
        tenantRef: protectedIdentifier(accountKey),
        sessionRef: protectedIdentifier(session.id),
        gameId: session.gameId,
        status: session.status || ''
      });
    } else if (previous.status !== session.status) {
      logDomainChange('game-status-changed', {
        tenantRef: protectedIdentifier(accountKey),
        sessionRef: protectedIdentifier(session.id),
        gameId: session.gameId,
        from: previous.status || '',
        to: session.status || ''
      });
    }
  }

  for (const interest of nextState.interests || []) {
    if (!previousInterests.has(interest.id)) {
      logDomainChange('game-request-added', {
        tenantRef: protectedIdentifier(accountKey),
        requestRef: protectedIdentifier(interest.id),
        subjectRef: protectedIdentifier(interest.profileId),
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
