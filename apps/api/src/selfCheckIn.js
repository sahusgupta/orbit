const activeInterestStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const availableTableStatuses = new Set(['Running', 'Forming']);
const maximumPokerTableSeats = 10;
const maximumStaffRequests = 200;

function normalizedName(value) {
  try {
    return String(value || '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
  } catch {
    return '';
  }
}

function findSelfCheckInProfile(state, lookupKey) {
  const matches = (state.profiles || []).filter((profile) => normalizedName(profile.name) === lookupKey);
  if (!matches.length) return { kind: 'unmatched' };
  if (matches.length !== 1) return { kind: 'ambiguous' };
  return { kind: 'matched', profile: matches[0] };
}

function activeSessionsForTable(state, tableId) {
  return (state.playerSessions || []).filter((session) => session.tableId === tableId && !session.leftAt);
}

function getAvailableSeatNumber(state, table) {
  const activeSessions = activeSessionsForTable(state, table.id);
  const maximumSeats = Number(table.maxSeats || 0);
  if (
    !Number.isInteger(maximumSeats) ||
    maximumSeats <= 0 ||
    maximumSeats > maximumPokerTableSeats ||
    activeSessions.length >= maximumSeats
  ) return undefined;
  const occupied = new Set(activeSessions
    .map((session) => session.seatNumber)
    .filter((seat) => Number.isInteger(seat) && seat > 0 && seat <= maximumSeats));
  for (let seat = 1; seat <= maximumSeats; seat += 1) {
    if (!occupied.has(seat)) return seat;
  }
  return undefined;
}

function getAvailableSelfCheckInTables(state) {
  const gamesById = new Map((state.games || []).map((game) => [game.id, game]));
  return (state.sessions || []).flatMap((table) => {
    const game = gamesById.get(table.gameId);
    const seatNumber = availableTableStatuses.has(table.status) && game
      ? getAvailableSeatNumber(state, table)
      : undefined;
    if (!seatNumber) return [];
    const maximumSeats = Number(table.maxSeats);
    const activeCount = activeSessionsForTable(state, table.id).length;
    return [{
      id: table.id,
      label: String(table.label || game.name || 'Table').slice(0, 120),
      gameId: table.gameId,
      gameName: String(game.name || '').slice(0, 120),
      status: table.status,
      availableSeats: Math.max(0, maximumSeats - activeCount),
      maxSeats: maximumSeats
    }];
  });
}

function appendSelfCheckInAssistanceRequest(state, request) {
  const current = state.staffRequests || [];
  const reason = request.reason === 'ambiguous' ? 'ambiguous' : 'not-found';
  const lookupKey = normalizedName(request.playerName);
  const equivalent = current.find((candidate) =>
    candidate.type === 'self-check-in-assistance' &&
    candidate.status !== 'handled' &&
    candidate.reason === reason &&
    normalizedName(candidate.playerName) === lookupKey
  );
  if (equivalent) {
    return { ok: true, state, request: equivalent, duplicate: true };
  }

  const conflictingId = current.find((candidate) => candidate.id === request.id);
  if (conflictingId) {
    return { ok: false, code: 'SELF_CHECK_IN_ASSISTANCE_ID_CONFLICT', state };
  }

  const pending = current.filter((candidate) => candidate.status !== 'handled');
  if (pending.length >= maximumStaffRequests) {
    return { ok: false, code: 'SELF_CHECK_IN_ASSISTANCE_QUEUE_FULL', state };
  }

  const requestRecord = {
    id: request.id,
    type: 'self-check-in-assistance',
    playerName: request.playerName,
    reason,
    status: 'pending',
    createdAt: request.createdAt
  };
  const handledSlots = maximumStaffRequests - pending.length - 1;
  const handledToRetain = handledSlots > 0
    ? current.filter((candidate) => candidate.status === 'handled').slice(-handledSlots)
    : [];
  const retainedHandled = new Set(handledToRetain);
  const retained = current.filter((candidate) => candidate.status !== 'handled' || retainedHandled.has(candidate));
  const nextState = {
    ...state,
    staffRequests: [...retained, requestRecord]
  };
  return { ok: true, state: nextState, request: requestRecord, duplicate: false };
}

function updateProfileGameHistory(state, profileId, gameId) {
  const gameName = (candidateId) => state.games?.find((game) => game.id === candidateId)?.name || candidateId;
  return (state.profiles || []).map((profile) => {
    if (profile.id !== profileId) return profile;
    const counts = {
      ...(profile.gamePlayCounts || {}),
      [gameId]: Number(profile.gamePlayCounts?.[gameId] || 0) + 1
    };
    const mostPlayedGameId = Object.entries(counts)
      .sort((left, right) => Number(right[1]) - Number(left[1]) || gameName(left[0]).localeCompare(gameName(right[0])))[0]?.[0] || gameId;
    return {
      ...profile,
      gamePlayCounts: counts,
      mostPlayedGameId,
      preferredGameId: profile.preferredGameId || gameId,
      preferredGameIds: Array.from(new Set([...(profile.preferredGameIds || []), gameId]))
    };
  });
}

function seatSelfCheckInPlayer(state, input) {
  const profile = (state.profiles || []).find((candidate) => candidate.id === input.profileId);
  if (!profile) return { ok: false, code: 'PLAYER_NOT_FOUND', error: 'The player profile is no longer available.' };
  const alreadySeated = (state.playerSessions || []).find((session) => session.profileId === profile.id && !session.leftAt);
  if (alreadySeated) return { ok: false, code: 'ALREADY_SEATED', error: `${profile.name} is already seated.` };

  const table = (state.sessions || []).find((candidate) => candidate.id === input.tableId);
  const game = table ? (state.games || []).find((candidate) => candidate.id === table.gameId) : undefined;
  const seatNumber = table && game && availableTableStatuses.has(table.status)
    ? getAvailableSeatNumber(state, table)
    : undefined;
  if (!table || !game || !seatNumber) {
    return { ok: false, code: 'TABLE_UNAVAILABLE', error: 'That table is no longer available.' };
  }

  const matchingInterest = (state.interests || []).find((interest) =>
    interest.profileId === profile.id &&
    interest.gameId === table.gameId &&
    activeInterestStatuses.has(interest.status)
  );
  const interests = matchingInterest
    ? state.interests.map((interest) => interest.id === matchingInterest.id
      ? {
          ...interest,
          status: 'Seated',
          tableId: table.id,
          arrivedAt: interest.arrivedAt || input.timestamp,
          seatedAt: interest.seatedAt || input.timestamp,
          timestamp: input.timestamp
        }
      : interest)
    : [
        ...(state.interests || []),
        {
          id: input.interestId,
          profileId: profile.id,
          playerName: profile.name,
          gameId: table.gameId,
          status: 'Seated',
          timestamp: input.timestamp,
          interestedAt: input.timestamp,
          arrivedAt: input.timestamp,
          seatedAt: input.timestamp,
          tableId: table.id,
          notes: 'Seated through club QR self-check-in'
        }
      ];
  const playerSession = {
    id: input.playerSessionId,
    playerName: profile.name,
    profileId: profile.id,
    gameId: table.gameId,
    tableId: table.id,
    seatNumber,
    seatedAt: input.timestamp,
    timePurchasedMinutes: 0,
    timeRemainingMinutes: 0,
    lastTimeTickAt: input.timestamp,
    timeFeeEnabled: false
  };
  const nextStatus = table.status === 'Forming' ? 'Running' : table.status;
  const nextState = {
    ...state,
    profiles: updateProfileGameHistory(state, profile.id, table.gameId),
    interests,
    playerSessions: [...(state.playerSessions || []), playerSession],
    sessions: state.sessions.map((candidate) => candidate.id === table.id
      ? {
          ...candidate,
          status: nextStatus,
          seatsFilled: activeSessionsForTable(state, table.id).length + 1,
          startedAt: nextStatus === 'Running' ? candidate.startedAt || input.timestamp : candidate.startedAt
        }
      : candidate),
    playerLedger: [
      {
        id: input.ledgerId,
        type: 'Check-In',
        profileId: profile.id,
        playerName: profile.name,
        tableId: table.id,
        gameId: table.gameId,
        timestamp: input.timestamp,
        note: `Self-check-in: seat ${seatNumber}`
      },
      ...(state.playerLedger || [])
    ]
  };
  return {
    ok: true,
    state: nextState,
    seatNumber,
    playerName: profile.name,
    profileId: profile.id,
    tableId: table.id,
    tableLabel: table.label,
    gameId: table.gameId,
    gameName: game.name
  };
}

module.exports = {
  appendSelfCheckInAssistanceRequest,
  findSelfCheckInProfile,
  getAvailableSeatNumber,
  getAvailableSelfCheckInTables,
  seatSelfCheckInPlayer
};
