const activeWaitlistStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const playerVisibleWaitlistStatuses = new Set([
  ...activeWaitlistStatuses,
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated'
]);
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
  if (!value) return false;
  const text = String(value);
  const expiration = new Date(text.includes('T') ? text : `${text.slice(0, 10)}T23:59:59`).getTime();
  return Number.isFinite(expiration) && expiration >= Date.now();
}

function getMembershipWindow(request) {
  const requestedAt = request.requestedAt || new Date().toISOString();
  const plan = request.plan === 'day' ? 'day' : 'monthly';
  const paymentMethod = request.paymentMethod === 'in-person' ? 'in-person' : 'app';
  const active = paymentMethod !== 'in-person';
  const start = new Date(requestedAt);
  const expires = new Date(start);
  expires.setDate(expires.getDate() + (plan === 'day' ? 1 : 30));
  return {
    plan,
    paymentMethod,
    status: active ? 'Active' : 'Requested',
    requestedAt,
    startDate: active ? start.toISOString().slice(0, 10) : '',
    expirationDate: active ? expires.toISOString().slice(0, 10) : '',
    expiresAt: active ? expires.toISOString() : undefined
  };
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
  let activePosition = 0;
  return (interests || [])
    .filter((interest) => interest.gameId === gameId && playerVisibleWaitlistStatuses.has(interest.status))
    .sort((left, right) => getInterestTime(left).localeCompare(getInterestTime(right)))
    .map((interest) => {
      const isActive = activeWaitlistStatuses.has(interest.status);
      if (isActive) activePosition += 1;
      return {
        id: interest.id,
        clubId,
        gameId,
        playerId: interest.profileId,
        playerName: interest.playerName,
        status: interest.status,
        position: isActive ? activePosition : 0,
        requestedAt: getInterestTime(interest),
        tableId: interest.tableId
      };
    });
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
  const notifications = (state.inAppNotifications || []).filter((notification) => {
    if (!player?.id && !playerName) return true;
    const playerId = String(player?.id || '').trim().toLowerCase();
    const targetIds = (notification.targetPlayerIds || []).map((target) => String(target).trim().toLowerCase());
    const targetNames = (notification.targetPlayerNames || []).map((target) => String(target).trim().toLowerCase());
    return Boolean(playerId && targetIds.includes(playerId)) || Boolean(playerName && targetNames.includes(playerName));
  });
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
      status: profile.membershipStatus === 'Requested'
        ? 'Requested'
        : isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate) ? 'Active' : 'Expired',
      joinedAt: profile.membershipStartDate || new Date().toISOString().slice(0, 10),
      expiresAt: profile.membershipExpiresAt || profile.membershipExpirationDate,
      plan: profile.membershipPlan,
      paymentMethod: profile.membershipPaymentMethod,
      requestedAt: profile.membershipRequestedAt,
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
      const gameWaitlist = waitlists.filter((entry) => entry.gameId === game.id && activeWaitlistStatuses.has(entry.status));
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        collectionMode:
          state.settings?.collectionProfiles?.find((profile) => profile.gameId === game.id)?.collectionMode ||
          openTables[0]?.collectionMode ||
          state.settings?.defaultCollectionMode ||
          'Drop',
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: openTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: openTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    notifications,
    social: {
      activePlayerCount: activePlayerSessions.length || tables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.filter((entry) => activeWaitlistStatuses.has(entry.status)).length
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
  const membership = getMembershipWindow(request);

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              membershipStartDate: membership.startDate || profile.membershipStartDate,
              membershipExpirationDate: membership.expirationDate,
              membershipExpiresAt: membership.expiresAt,
              membershipPlan: membership.plan,
              membershipPaymentMethod: membership.paymentMethod,
              membershipStatus: membership.status,
              membershipRequestedAt: membership.requestedAt,
              membershipPriceLabel: request.priceLabel,
              preferredGameId: player.preferredGameIds?.[0] || profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...(player.preferredGameIds || [])]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability,
              phone: player.phone || profile.phone,
              notes: appendSyncNote(profile.notes, membership.status === 'Requested'
                ? `Player app: ${membership.plan} pass requested; pay in person (${player.email || player.id})`
                : `Player app: ${membership.plan} pass paid in app (${player.email || player.id})`)
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
        phone: player.phone || '',
        birthday: '',
        membershipStartDate: membership.startDate,
        membershipExpirationDate: membership.expirationDate,
        membershipExpiresAt: membership.expiresAt,
        membershipPlan: membership.plan,
        membershipPaymentMethod: membership.paymentMethod,
        membershipStatus: membership.status,
        membershipRequestedAt: membership.requestedAt,
        membershipPriceLabel: request.priceLabel,
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
        notes: `${membership.status === 'Requested' ? 'Pay in person requested' : 'Paid in player app'}: ${player.email || ''}${player.phone ? `, ${player.phone}` : ''}`.trim()
      }
    ]
  };
}

function applyWaitlistRequestToState(state, request) {
  validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const profile = (state.profiles || []).find(
    (candidate) => candidate.id === player.id || String(candidate.name || '').toLowerCase() === String(player.name || '').toLowerCase()
  );
  const matchesPlayer = (interest) =>
    Boolean((profile && interest.profileId === profile.id) || String(interest.playerName || '').toLowerCase() === String(player.name || '').toLowerCase());
  if (request.action === 'cancel') {
    return {
      ...state,
      interests: (state.interests || []).map((interest) =>
        interest.gameId === request.gameId && activeWaitlistStatuses.has(interest.status) && matchesPlayer(interest)
          ? {
              ...interest,
              status: 'Removed',
              notes: appendSyncNote(interest.notes, `Seat request cancelled in Player app at ${request.requestedAt || new Date().toISOString()}`)
            }
          : interest
      )
    };
  }
  const requestedTable = request.tableId
    ? (state.sessions || []).find((session) => session.id === request.tableId && session.status !== 'Closed' && session.status !== 'Failed to Start')
    : undefined;
  const alreadyWaiting = (state.interests || []).some(
    (interest) =>
      interest.gameId === request.gameId &&
      activeWaitlistStatuses.has(interest.status) &&
      matchesPlayer(interest)
  );
  if (alreadyWaiting) return state;
  const attendance = request.attendance || (requestedTable ? 'arrived' : 'interested');
  const status = attendance === 'arrived' ? 'Arrived' : attendance === 'confirmed' ? 'Confirmed Coming' : 'Interested';
  const requestedAt = request.requestedAt || new Date().toISOString();
  const syncedProfile = profile || {
    id: player.id,
    name: player.name || 'Player',
    phone: player.phone || '',
    birthday: '',
    membershipStartDate: '',
    membershipExpirationDate: '',
    totalTimePlayedHours: 0,
    lastSessionTimePlayedHours: 0,
    commonlyPlaysWithProfileIds: [],
    preferredGameId: request.gameId,
    preferredGameIds: [request.gameId],
    preferredStakes: '',
    typicalBuyInMin: 0,
    typicalBuyInMax: 0,
    willingnessToMove: false,
    typicalAvailability: '',
    preferredTags: [],
    usualCompanions: [],
    notes: `Player app: ${player.email || ''}${player.phone ? `, ${player.phone}` : ''}`
  };
  const profiles = profile
    ? (state.profiles || []).map((candidate) => candidate.id === profile.id
      ? {
          ...candidate,
          phone: player.phone || candidate.phone,
          preferredGameId: candidate.preferredGameId || request.gameId,
          preferredGameIds: Array.from(new Set([...(candidate.preferredGameIds || []), request.gameId])),
          notes: appendSyncNote(candidate.notes, `Player app: ${player.email || ''}`)
        }
      : candidate)
    : [...(state.profiles || []), syncedProfile];
  return {
    ...state,
    profiles,
    interests: [
      ...(state.interests || []),
      {
        id: request.id,
        profileId: syncedProfile.id,
        playerName: player.name || 'Player',
        gameId: request.gameId,
        status,
        timestamp: requestedAt,
        interestedAt: requestedAt,
        confirmedAt: status === 'Confirmed Coming' ? requestedAt : undefined,
        arrivedAt: status === 'Arrived' ? requestedAt : undefined,
        expectedArrivalTime: request.expectedArrivalTime,
        availabilityStartTime: request.availabilityStartTime,
        availabilityEndTime: request.availabilityEndTime,
        tableId: requestedTable?.id,
        notes: [
          status === 'Arrived'
            ? `At club now; seat requested for ${requestedTable?.label || 'open table'}`
            : status === 'Confirmed Coming'
              ? `Confirmed coming${request.expectedArrivalTime ? ` at ${request.expectedArrivalTime}` : ''}`
              : `Interested${request.availabilityStartTime ? ` from ${request.availabilityStartTime}${request.availabilityEndTime ? ` to ${request.availabilityEndTime}` : ''}` : ''}`,
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
