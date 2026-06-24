const activeWaitlistStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const visibleTableStatuses = new Set(['Running', 'Forming', 'Paused']);

function isRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateStatePayload(state) {
  if (!isRecord(state)) throw new Error('State payload must be an object.');
  if (!Array.isArray(state.games)) throw new Error('State payload is missing games.');
  if (!Array.isArray(state.sessions)) throw new Error('State payload is missing sessions.');
  if (!Array.isArray(state.playerSessions)) throw new Error('State payload is missing player sessions.');
  if (!isRecord(state.settings)) throw new Error('State payload is missing settings.');
}

function sanitizeAccountKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function getAccountKeyFromAccess(access) {
  if (!isRecord(access)) return '';
  return sanitizeAccountKey(access.licenseId || access.authorizationCode || access.issuedTo);
}

function getAccountKeyFromState(state) {
  const pilotKey = getAccountKeyFromAccess(state?.settings?.pilotAccess);
  if (pilotKey) return pilotKey;
  const club = state?.settings?.clubAccount;
  return sanitizeAccountKey(club?.email || club?.clubName || 'unlicensed-local') || 'unlicensed-local';
}

function isFutureDate(value) {
  return Boolean(value && new Date(`${String(value).slice(0, 10)}T23:59:59`).getTime() >= Date.now());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

function mergeUnique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function appendSyncNote(existing, note) {
  if (!existing) return note;
  if (existing.includes(note)) return existing;
  return `${existing} | ${note}`;
}

function getInterestTime(interest) {
  return interest.interestedAt || interest.timestamp || '';
}

function getPlayerLoyalty(clubId, lifetimeHours = 0) {
  const hours = Math.max(0, Number(lifetimeHours) || 0);
  if (hours >= 120) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Anchor', nextTierAtHours: null };
  if (hours >= 50) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Preferred', nextTierAtHours: 120 };
  if (hours >= 12) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Regular', nextTierAtHours: 50 };
  return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'New', nextTierAtHours: 12 };
}

function getWaitlistEntriesForGame(interests, clubId, gameId) {
  return (interests || [])
    .filter((interest) => interest.gameId === gameId && activeWaitlistStatuses.has(interest.status))
    .sort((left, right) => getInterestTime(left).localeCompare(getInterestTime(right)))
    .map((interest, index) => ({
      id: interest.id,
      clubId,
      gameId,
      playerId: interest.profileId,
      playerName: interest.playerName,
      status: interest.status,
      position: index + 1,
      requestedAt: getInterestTime(interest)
    }));
}

function buildPlayerClubSnapshot(state, player = {}) {
  validateStatePayload(state);
  const clubId = getAccountKeyFromState(state);
  const account = state.settings?.clubAccount || {};
  const activePlayerSessions = (state.playerSessions || []).filter((session) => !session.leftAt);
  const activeAdminCount = (state.settings?.staffAccounts || []).filter((staff) => staff.active !== false).length;
  const playerName = String(player?.name || '').trim().toLowerCase();
  const requestingProfile = (state.profiles || []).find(
    (profile) => profile.id === player?.id || String(profile.name || '').trim().toLowerCase() === playerName
  );
  const knownProfileIds = new Set(requestingProfile?.commonlyPlaysWithProfileIds || []);
  const knownPlayerNames = new Set((requestingProfile?.usualCompanions || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean));
  const isKnownPlayerSession = (session) =>
    Boolean((session.profileId && knownProfileIds.has(session.profileId)) || knownPlayerNames.has(String(session.playerName || '').trim().toLowerCase()));
  const tables = (state.sessions || [])
    .filter((session) => visibleTableStatuses.has(session.status))
    .map((session) => {
      const seatedSessions = activePlayerSessions.filter((playerSession) => playerSession.tableId === session.id);
      return {
        id: session.id,
        gameId: session.gameId,
        label: session.label,
        status: session.status,
        seatsFilled: Math.min(session.seatsFilled, session.maxSeats),
        maxSeats: session.maxSeats,
        availableSeats: Math.max(0, session.maxSeats - session.seatsFilled),
        collectionMode: session.collectionMode || (session.timeFeeBased ? 'Time' : 'Drop'),
        tags: session.tags || [],
        startedAt: session.startedAt,
        social: {
          seatedPlayerCount: seatedSessions.length || Math.min(session.seatsFilled, session.maxSeats),
          adminCount: activeAdminCount,
          knownPlayersCount: seatedSessions.filter(isKnownPlayerSession).length
        }
      };
    });
  const waitlists = (state.games || []).flatMap((game) => getWaitlistEntriesForGame(state.interests || [], clubId, game.id));
  const memberships = (state.profiles || [])
    .filter((profile) => {
      if (!player?.id && !playerName) return true;
      return profile.id === player.id || String(profile.name || '').trim().toLowerCase() === playerName;
    })
    .map((profile) => ({
      id: `${clubId}:${profile.id}`,
      clubId,
      playerId: profile.id,
      playerName: profile.name,
      status: isFutureDate(profile.membershipExpirationDate) ? 'Active' : 'Expired',
      joinedAt: profile.membershipStartDate || new Date().toISOString().slice(0, 10),
      expiresAt: profile.membershipExpirationDate,
      loyalty: getPlayerLoyalty(clubId, profile.totalTimePlayedHours || 0),
      preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : profile.preferredGameId ? [profile.preferredGameId] : [],
      preferredStakes: profile.preferredStakes,
      clubNote: profile.typicalAvailability
    }));

  return {
    club: {
      id: clubId,
      name: account.clubName || 'Local Poker Club',
      address: account.address,
      phone: account.phone
    },
    games: (state.games || []).map((game) => {
      const openTables = tables.filter((table) => table.gameId === game.id);
      const gameWaitlist = waitlists.filter((entry) => entry.gameId === game.id);
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: openTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: openTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    social: {
      activePlayerCount: activePlayerSessions.length || tables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.length
    },
    generatedAt: new Date().toISOString()
  };
}

function applyMembershipRequestToState(state, request) {
  validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const existingProfile = (state.profiles || []).find(
    (profile) => profile.id === player.id || String(profile.name || '').toLowerCase() === String(player.name || '').toLowerCase()
  );
  const membershipStartDate = String(request.requestedAt || new Date().toISOString()).slice(0, 10);
  const membershipExpirationDate = addDays(membershipStartDate, 365);

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              membershipStartDate: profile.membershipStartDate || membershipStartDate,
              membershipExpirationDate: profile.membershipExpirationDate || membershipExpirationDate,
              preferredGameId: player.preferredGameIds?.[0] || profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...(player.preferredGameIds || [])]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability,
              notes: appendSyncNote(profile.notes, `Player app: ${player.email || player.id}`)
            }
          : profile
      )
    };
  }

  return {
    ...state,
    profiles: [
      ...(state.profiles || []),
      {
        id: player.id || request.id,
        name: player.name || 'Player',
        birthday: '',
        membershipStartDate,
        membershipExpirationDate,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: player.preferredGameIds?.[0] || state.games?.[0]?.id || '',
        preferredGameIds: player.preferredGameIds || [],
        preferredStakes: player.preferredStakes || '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability || '',
        preferredTags: [],
        usualCompanions: [],
        notes: `Player app: ${player.email || ''}${player.phone ? `, ${player.phone}` : ''}`.trim()
      }
    ]
  };
}

function applyWaitlistRequestToState(state, request) {
  validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const requestedTable = request.tableId
    ? (state.sessions || []).find((session) => session.id === request.tableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
    : undefined;
  const requestedTableHasSeat = Boolean(requestedTable && requestedTable.seatsFilled < requestedTable.maxSeats);
  const profile = (state.profiles || []).find(
    (candidate) => candidate.id === player.id || String(candidate.name || '').toLowerCase() === String(player.name || '').toLowerCase()
  );
  const alreadyWaiting = (state.interests || []).some(
    (interest) =>
      interest.gameId === request.gameId &&
      activeWaitlistStatuses.has(interest.status) &&
      (interest.profileId === profile?.id || String(interest.playerName || '').toLowerCase() === String(player.name || '').toLowerCase())
  );
  if (alreadyWaiting) return state;
  return {
    ...state,
    interests: [
      ...(state.interests || []),
      {
        id: request.id,
        profileId: profile?.id || player.id,
        playerName: player.name || 'Player',
        gameId: request.gameId,
        status: requestedTableHasSeat ? 'Arrived' : 'Interested',
        timestamp: request.requestedAt || new Date().toISOString(),
        interestedAt: request.requestedAt || new Date().toISOString(),
        arrivedAt: requestedTableHasSeat ? request.requestedAt || new Date().toISOString() : undefined,
        notes: [
          requestedTableHasSeat ? `Seat requested from player app for ${requestedTable?.label || 'open table'}` : 'Waitlist requested from player app',
          request.note
        ].filter(Boolean).join(' | ')
      }
    ]
  };
}

module.exports = {
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  getAccountKeyFromState,
  sanitizeAccountKey,
  validateStatePayload
};
