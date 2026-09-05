const crypto = require('crypto');
const fs = require('fs');
const { buildPlayerClubSnapshot, getAccountKeyFromState } = require('./orbitCore');
const { protectedIdentifier } = require('./operations/dataProtection');

const firebaseConfig = {
  projectId: 'tabletalk-s'
};
const orbitSyncProtocolVersion = 2;

class FirebasePublicationError extends Error {
  constructor(category, options = {}) {
    const safeCategory = /^[a-z0-9-]{1,64}$/.test(String(category || ''))
      ? String(category)
      : 'provider-failure';
    const status = Number(options.status);
    const safeStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
    const pathRef = /^[a-f0-9]{16}$/.test(String(options.pathRef || '')) ? String(options.pathRef) : '';
    const responseRef = /^[a-f0-9]{16}$/.test(String(options.responseRef || '')) ? String(options.responseRef) : '';
    const details = [
      `category=${safeCategory}`,
      safeStatus ? `status=${safeStatus}` : '',
      pathRef ? `pathRef=${pathRef}` : '',
      responseRef ? `responseRef=${responseRef}` : ''
    ].filter(Boolean).join(' ');
    super(`Firebase publication provider failure (${details}).`);
    this.name = 'FirebasePublicationError';
    this.code = 'FIREBASE_PUBLICATION_FAILED';
    this.category = safeCategory;
    this.status = safeStatus;
    this.pathRef = pathRef;
    this.responseRef = responseRef;
  }
}

async function firebaseResponseError(category, response, path = '') {
  let responseText = '';
  try {
    responseText = String(await response.text()).slice(0, 4_096);
  } catch {
    responseText = 'unreadable-provider-response';
  }
  return new FirebasePublicationError(category, {
    status: response.status,
    pathRef: path ? protectedIdentifier(path) : '',
    responseRef: protectedIdentifier(responseText || `empty-response:${response.status}`)
  });
}

function firebaseRequestError(category, error, path = '') {
  return new FirebasePublicationError(category, {
    pathRef: path ? protectedIdentifier(path) : '',
    responseRef: protectedIdentifier(error instanceof Error ? error.message : 'provider-request-failed')
  });
}

async function fetchFirebase(category, input, init, path = '') {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw firebaseRequestError(category, error, path);
  }
}

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/**
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function getRecordProperty(value, key) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Reflect.get(value, key)
    : undefined;
}

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const value = process.env.FIREBASE_SERVICE_ACCOUNT_JSON.trim();
    return JSON.parse(value);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8'));
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
  }
  return null;
}

function getFirebasePublisherStatus() {
  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      return {
        configured: false,
        projectId: firebaseConfig.projectId,
        credentialSource: ''
      };
    }
    return {
      configured: true,
      projectId: serviceAccount.project_id || firebaseConfig.projectId,
      credentialSource: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        ? 'FIREBASE_SERVICE_ACCOUNT_JSON'
        : process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
          ? 'FIREBASE_SERVICE_ACCOUNT_BASE64'
          : 'GOOGLE_APPLICATION_CREDENTIALS',
      clientEmail: serviceAccount.client_email || ''
    };
  } catch (error) {
    return {
      configured: false,
      projectId: firebaseConfig.projectId,
      credentialSource: 'invalid',
      error: 'Firebase publisher credentials are invalid.',
      errorRef: protectedIdentifier(error instanceof Error ? error.message : 'invalid-firebase-credentials')
    };
  }
}

async function getServiceAccountToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsignedJwt = `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsignedJwt)
    .sign(serviceAccount.private_key, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const response = await fetchFirebase('token-request', 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`
    })
  });
  if (!response.ok) throw await firebaseResponseError('token-request', response);
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw firebaseRequestError('token-response-invalid', error);
  }
  const accessToken = getRecordProperty(payload, 'access_token');
  if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('Firebase token response did not include an access token.');
  }
  return accessToken;
}

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : stripUndefined(item)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, stripUndefined(item)])
    );
  }
  return value;
}

function buildSyncMetadata(savedAt, syncRevision, entityCounts) {
  return {
    syncProtocolVersion: orbitSyncProtocolVersion,
    syncRevision,
    syncSource: 'orbit-api',
    publishedAt: savedAt,
    entityCounts
  };
}

function buildPlayerGameDocs(snapshot, clubId) {
  return (snapshot.games || []).map((game) => ({ ...game, clubId }));
}

function jsToFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  if (typeof value === 'object') return { mapValue: { fields: jsToFirestoreFields(value) } };
  return { stringValue: String(value) };
}

function jsToFirestoreFields(record) {
  return Object.fromEntries(Object.entries(stripUndefined(record)).map(([key, value]) => [key, jsToFirestoreValue(value)]));
}

function firestoreDocumentId(value, fallback = 'unknown') {
  return String(value || fallback)
    .trim()
    .replace(/\//g, '-')
    .slice(0, 128) || fallback;
}

function playerHash(profile, clubId) {
  const seed = [
    clubId,
    profile?.id,
    profile?.email,
    profile?.phone,
    profile?.name
  ].map((value) => String(value || '').trim().toLowerCase()).filter(Boolean).join(':');
  return crypto.createHash('sha256').update(seed || `${clubId}:unknown-player`).digest('hex').slice(0, 32);
}

function playerDocumentId(profile, clubId) {
  if (String(profile?.id || '').trim()) return firestoreDocumentId(profile.id);
  return playerHash(profile, clubId);
}

function hoursBetween(start, end = new Date().toISOString()) {
  if (!start) return 0;
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 36e5);
}

function getCollectionProfile(state, gameId) {
  const collectionProfiles = state.settings?.collectionProfiles || [];
  const configuredProfile = collectionProfiles.find((profile) => profile.gameId === gameId);
  const legacyRoomProfile = collectionProfiles.find((profile) => profile.collectionMode === 'Time') || collectionProfiles[0];
  const collectionMode = configuredProfile?.collectionMode === 'Time' || configuredProfile?.collectionMode === 'Drop'
    ? configuredProfile.collectionMode
    : state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
      ? state.settings.defaultCollectionMode
      : undefined;
  const roomHourlyFee = state.settings?.defaultHourlyFee ?? legacyRoomProfile?.hourlyFee;
  const estimatedDropPerSeatHour = configuredProfile?.estimatedDropPerSeatHour ?? state.settings?.defaultEstimatedDropPerSeatHour;
  return {
    ...(configuredProfile || {}),
    gameId,
    ...(collectionMode ? { collectionMode } : {}),
    ...(typeof roomHourlyFee === 'number' && Number.isFinite(roomHourlyFee) ? { hourlyFee: roomHourlyFee } : {}),
    ...(typeof estimatedDropPerSeatHour === 'number' && Number.isFinite(estimatedDropPerSeatHour)
      ? { estimatedDropPerSeatHour }
      : {})
  };
}

function getSessionSeatHours(state, session) {
  return (state.playerSessions || [])
    .filter((playerSession) => playerSession.tableId === session.id)
    .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0);
}

function getPlayerSessionsForProfile(state, profile) {
  const profileId = String(profile?.id || '').trim();
  if (!profileId) return [];
  return (state.playerSessions || []).filter((session) => session.profileId === profileId);
}

function getGamesPlayed(state, profile, playerSessions) {
  const counts = { ...(profile?.gamePlayCounts || {}) };
  for (const session of playerSessions) {
    counts[session.gameId] = (Number(counts[session.gameId] || 0) || 0) + 1;
  }
  return Object.entries(counts)
    .map(([gameId, count]) => ({
      gameId,
      name: (state.games || []).find((game) => game.id === gameId)?.name || gameId,
      count: Number(count) || 0
    }))
    .filter((game) => game.count > 0)
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function getPlayerContribution(state, playerSessions) {
  let timeFeeContribution = 0;
  let estimatedDropContribution = 0;
  let recordedDropContribution = 0;

  for (const playerSession of playerSessions) {
    const session = (state.sessions || []).find((item) => item.id === playerSession.tableId);
    if (!session) continue;
    const profile = getCollectionProfile(state, playerSession.gameId);
    const mode = session.collectionMode === 'Time' || session.collectionMode === 'Drop'
      ? session.collectionMode
      : session.timeFeeBased
        ? 'Time'
        : profile.collectionMode;
    if (mode === 'Time') {
      const timeFeeLogs = (state.timeFeeLogs || []).filter(
        (entry) => entry.playerSessionId === playerSession.id
      );
      const loggedMinutes = timeFeeLogs.reduce(
        (sum, entry) => sum + Math.max(0, Number(entry.minutes || 0) || 0),
        0
      );
      const unloggedMinutes = Math.max(
        0,
        (Number(playerSession.timePurchasedMinutes || 0) || 0) - loggedMinutes
      );
      timeFeeContribution += timeFeeLogs.reduce(
        (sum, entry) => sum + (Number(entry.amount || 0) || 0),
        0
      ) + (unloggedMinutes / 60) * (Number(profile.hourlyFee || 0) || 0);
      continue;
    }
    if (mode !== 'Drop') continue;

    const playerHours = hoursBetween(playerSession.seatedAt, playerSession.leftAt);
    estimatedDropContribution += playerHours * (Number(profile.estimatedDropPerSeatHour || 0) || 0);
    const tablePlayers = (state.playerSessions || []).filter((item) => item.tableId === session.id);
    const tableDrop = (state.dropLogs || [])
      .filter((drop) => drop.tableId === session.id)
      .reduce((sum, drop) => sum + (Number(drop.amount || 0) || 0), 0);
    if (tablePlayers.length) recordedDropContribution += tableDrop / tablePlayers.length;
  }

  return {
    roughAmountContributedToDrop: Math.round((recordedDropContribution || estimatedDropContribution || timeFeeContribution) * 100) / 100,
    recordedDropContribution: Math.round(recordedDropContribution * 100) / 100,
    estimatedDropContribution: Math.round(estimatedDropContribution * 100) / 100,
    timeFeeContribution: Math.round(timeFeeContribution * 100) / 100
  };
}

function getClubFormat(state) {
  const modes = new Set((state.sessions || []).map((session) => session.collectionMode || (session.timeFeeBased ? 'Time' : '')).filter(Boolean));
  if (modes.size > 1) return 'Mixed';
  if (modes.size === 1) return [...modes][0];
  return state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
    ? state.settings.defaultCollectionMode
    : undefined;
}

function buildCanonicalPlayerDocs(state, clubId, savedAt) {
  return (state.profiles || []).map((profile) => {
    const sessions = getPlayerSessionsForProfile(state, profile);
    const totalHoursPlayed = typeof profile.totalTimePlayedHours === 'number' && Number.isFinite(profile.totalTimePlayedHours)
      ? profile.totalTimePlayedHours
      : sessions.reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt), 0);
    const contribution = getPlayerContribution(state, sessions);
    const id = playerDocumentId(profile, clubId);
    return {
      id,
      sourceProfileId: profile.id || '',
      name: profile.name || '',
      dateJoined: profile.membershipStartDate || '',
      dateMembershipStarted: profile.membershipStartDate || '',
      dateMembershipShouldEnd: profile.membershipExpirationDate || '',
      gamesPlayed: getGamesPlayed(state, profile, sessions),
      totalHoursPlayed: Math.round(totalHoursPlayed * 100) / 100,
      roughAmountContributedToDrop: contribution.roughAmountContributedToDrop,
      contribution,
      phoneNumber: profile.phone || '',
      emailAddress: profile.email || '',
      preferredStakes: profile.preferredStakes || '',
      membershipActive: Boolean(profile.membershipExpirationDate && new Date(`${profile.membershipExpirationDate}T23:59:59`).getTime() >= Date.now()),
      updatedAt: savedAt
    };
  });
}

function buildCanonicalGameDocs(state, clubId, savedAt) {
  return (state.sessions || []).map((session) => {
    const game = (state.games || []).find((item) => item.id === session.gameId) || {};
    const seatedSessions = (state.playerSessions || []).filter((playerSession) => playerSession.tableId === session.id);
    const players = seatedSessions.map((playerSession) => ({
      profileId: playerSession.profileId || '',
      playerName: playerSession.playerName || '',
      seatNumber: playerSession.seatNumber || null,
      seatedAt: playerSession.seatedAt || '',
      leftAt: playerSession.leftAt || ''
    }));
    const waitlist = (state.interests || [])
      .filter((interest) => interest.gameId === session.gameId && ['Interested', 'Confirmed Coming', 'Arrived'].includes(interest.status))
      .sort((left, right) => String(left.interestedAt || left.timestamp || '').localeCompare(String(right.interestedAt || right.timestamp || '')))
      .map((interest) => interest.playerName || '');
    const buyins = (state.buyIns || [])
      .filter((buyIn) => buyIn.tableId === session.id)
      .map((buyIn) => ({
        playerName: buyIn.playerName || '',
        profileId: buyIn.profileId || '',
        amount: Number(buyIn.amount || 0) || 0,
        timestamp: buyIn.timestamp || '',
        note: buyIn.note || ''
      }));
    const cashOuts = (state.playerLedger || [])
      .filter((entry) => entry.type === 'Cash-Out' && entry.tableId === session.id)
      .map((entry) => ({
        playerName: entry.playerName || '',
        profileId: entry.profileId || '',
        amount: Number(entry.amount || 0) || 0,
        timestamp: entry.timestamp || '',
        note: entry.note || ''
      }));
    const totalBuyIns = buyins.reduce((sum, buyIn) => sum + buyIn.amount, 0);
    const totalCashedOut = cashOuts.reduce((sum, cashOut) => sum + cashOut.amount, 0);

    return {
      id: firestoreDocumentId(session.id, `${session.gameId}-${session.startedAt}`),
      clubId,
      gameId: session.gameId || '',
      gameName: game.name || session.gameId || '',
      date: String(session.startedAt || savedAt).slice(0, 10),
      stakes: session.stakes || game.stakes || '',
      format: session.collectionMode || (session.timeFeeBased ? 'Time' : getCollectionProfile(state, session.gameId).collectionMode),
      players,
      waitlist,
      timeStarted: session.startedAt || '',
      timeEnded: session.endedAt || '',
      buyins,
      totalAmountOnTable: Math.round((totalBuyIns - totalCashedOut) * 100) / 100,
      totalAmountCashedOut: Math.round(totalCashedOut * 100) / 100,
      status: session.status || '',
      label: session.label || '',
      updatedAt: savedAt
    };
  });
}

function buildCanonicalClubDoc(state, clubId, snapshot, playerDocs, savedAt) {
  const account = state.settings?.clubAccount || {};
  const publishedName = String(account.clubName || snapshot.club.name || '').trim();
  return {
    id: clubId,
    ...(publishedName ? { name: publishedName } : {}),
    address: account.address || '',
    ...(snapshot.club.minimumAge === 18 || snapshot.club.minimumAge === 21
      ? { minimumAge: snapshot.club.minimumAge }
      : {}),
    gamesOffered: (state.games || []).map((game) => ({
      id: game.id,
      name: game.name,
      maxSeats: game.maxSeats
    })),
    format: getClubFormat(state),
    membershipOptions: snapshot.club.membershipOptions || [],
    playerCount: playerDocs.length,
    activeMembershipCount: playerDocs.filter((player) => player.membershipActive).length,
    updatedAt: savedAt
  };
}

function isPublishedNumber(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function buildPrivatePlayerNotificationDocs(snapshot, clubId) {
  return (snapshot.notifications || []).flatMap((notification) => {
    const targetPlayerIds = Array.from(new Set(
      (Array.isArray(notification.targetPlayerIds) ? notification.targetPlayerIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    if (targetPlayerIds.length !== 1) return [];
    return [{
      id: firestoreDocumentId(notification.id),
      clubId,
      gameId: String(notification.gameId || ''),
      title: String(notification.title || '').slice(0, 160),
      body: String(notification.body || '').slice(0, 1000),
      reason: String(notification.reason || ''),
      createdAt: String(notification.createdAt || ''),
      ...(notification.expiresAt ? { expiresAt: String(notification.expiresAt) } : {}),
      targetPlayerIds
    }];
  });
}

function buildPlayerTournamentDocs(state, clubId, savedAt, nowMs = Date.now()) {
  const evaluatedAtMs = Number(nowMs);
  return (state.tournaments || []).flatMap((tournament) => {
    const startsAt = tournament.scheduledAt || tournament.startedAt;
    const interestOpensAt = tournament.registrationOpensAt;
    const interestClosesAt = tournament.registrationClosesAt;
    const startsAtMs = Date.parse(String(startsAt || ''));
    const interestOpensAtMs = Date.parse(String(interestOpensAt || ''));
    const interestClosesAtMs = Date.parse(String(interestClosesAt || ''));
    if (
      tournament.status !== 'Draft' ||
      !String(tournament.id || '').trim() ||
      !String(tournament.name || '').trim() ||
      !Number.isFinite(evaluatedAtMs) ||
      !Number.isFinite(startsAtMs) ||
      !Number.isFinite(interestOpensAtMs) ||
      !Number.isFinite(interestClosesAtMs) ||
      startsAtMs <= evaluatedAtMs ||
      interestOpensAtMs >= interestClosesAtMs ||
      interestClosesAtMs > startsAtMs ||
      !isPublishedNumber(tournament.buyIn) ||
      !isPublishedNumber(tournament.startingStack)
    ) return [];
    const players = tournament.players || [];
    const rebuysAllowed = tournament.rebuysAllowed === true;
    const addOnsAllowed = tournament.addOnsAllowed === true;
    return [{
      id: firestoreDocumentId(tournament.id),
      clubId,
      name: tournament.name,
      startsAt,
      interestOpensAt,
      interestClosesAt,
      // This is explicit venue intent, not a clock-collapsed snapshot. Consumers
      // enforce the published window and the mutation service authorizes it again.
      interestStatus: tournament.registrationStatus === 'open' ? 'open' : 'closed',
      buyIn: tournament.buyIn,
      buyInPublished: true,
      ...(typeof tournament.prizePoolLabel === 'string' && tournament.prizePoolLabel.trim()
        ? { prizePoolLabel: tournament.prizePoolLabel.trim() }
        : {}),
      startingStack: tournament.startingStack,
      ...(isPublishedNumber(tournament.levels?.[0]?.durationMinutes, 0, 1440)
        ? { levelMinutes: tournament.levels[0].durationMinutes }
        : {}),
      ...(isPublishedNumber(tournament.lateRegistrationThroughLevel, 0, 1000)
        ? { lateRegistrationThroughLevel: tournament.lateRegistrationThroughLevel }
        : {}),
      rebuysAllowed,
      ...(rebuysAllowed && isPublishedNumber(tournament.rebuyPrice) ? { rebuyPrice: tournament.rebuyPrice } : {}),
      ...(rebuysAllowed && isPublishedNumber(tournament.rebuyStack) ? { rebuyStack: tournament.rebuyStack } : {}),
      unlimitedRebuys: rebuysAllowed && tournament.unlimitedRebuys === true,
      addOnsAllowed,
      ...(addOnsAllowed && isPublishedNumber(tournament.addOnPrice) ? { addOnPrice: tournament.addOnPrice } : {}),
      ...(addOnsAllowed && isPublishedNumber(tournament.addOnStack) ? { addOnStack: tournament.addOnStack } : {}),
      rules: Array.isArray(tournament.rules)
        ? tournament.rules.filter((rule) => typeof rule === 'string').map((rule) => rule.slice(0, 500))
        : [],
      withdrawalAllowed: tournament.unregisterAllowed === true,
      entrantCount: players.length,
      ...(players.every((player) => isPublishedNumber(player.rebuys))
        ? { totalRebuys: players.reduce((sum, player) => sum + player.rebuys, 0) }
        : {}),
      ...(players.every((player) => isPublishedNumber(player.addOns))
        ? { totalAddOns: players.reduce((sum, player) => sum + player.addOns, 0) }
        : {}),
      featured: Boolean(tournament.featured),
      updatedAt: savedAt
    }];
  });
}

function buildTournamentInterestDocs(state, clubId, savedAt) {
  return (state.tournamentInterests || []).flatMap((interest) => {
    if (
      !interest ||
      interest.clubId !== clubId ||
      typeof interest.id !== 'string' ||
      typeof interest.tournamentId !== 'string' ||
      typeof interest.playerId !== 'string' ||
      !['interested', 'withdrawn'].includes(interest.status) ||
      !Number.isFinite(Date.parse(String(interest.createdAt || ''))) ||
      !Number.isFinite(Date.parse(String(interest.updatedAt || ''))) ||
      (interest.withdrawnAt && !Number.isFinite(Date.parse(String(interest.withdrawnAt))))
    ) return [];
    return [{
      id: firestoreDocumentId(interest.id),
      tournamentId: interest.tournamentId,
      clubId,
      playerId: interest.playerId,
      status: interest.status,
      createdAt: interest.createdAt,
      updatedAt: interest.updatedAt,
      ...(interest.withdrawnAt ? { withdrawnAt: String(interest.withdrawnAt) } : {})
    }];
  });
}

function restBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

function firestoreResourceName(projectId, documentPath) {
  return `projects/${projectId}/databases/(default)/documents/${documentPath}`;
}

function buildBatchUpdate(projectId, documentPath, record) {
  return {
    update: {
      name: firestoreResourceName(projectId, documentPath),
      fields: jsToFirestoreFields(record)
    }
  };
}

async function batchWriteDocuments(projectId, token, writes, chunkSize = 250) {
  for (let offset = 0; offset < writes.length; offset += chunkSize) {
    const endpoint = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`;
    const response = await fetchFirebase(
      'batch-write',
      endpoint,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ writes: writes.slice(offset, offset + chunkSize) })
      }
    );
    if (!response.ok) throw await firebaseResponseError('batch-write', response, endpoint);
  }
  return writes.length;
}

async function patchDocument(projectId, token, path, record) {
  const endpoint = `${restBase(projectId)}/${path}`;
  const response = await fetchFirebase('document-write', endpoint, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ fields: jsToFirestoreFields(record) })
  });
  if (!response.ok) throw await firebaseResponseError('document-write', response, path);
}

async function deleteLegacyPlayerDocuments(projectId, token, clubId, playerDocs) {
  const expectedIdsByProfile = new Map(
    playerDocs.filter((player) => player.sourceProfileId).map((player) => [player.sourceProfileId, player.id])
  );
  if (!expectedIdsByProfile.size) return 0;

  const stalePaths = [];
  let pageToken = '';
  do {
    const endpoint = new URL(`${restBase(projectId)}/clubs/${encodeURIComponent(clubId)}/players`);
    endpoint.searchParams.set('pageSize', '500');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetchFirebase(
      'player-list',
      endpoint.toString(),
      { headers: { authorization: `Bearer ${token}` } },
      `clubs/${clubId}/players`
    );
    if (!response.ok) throw await firebaseResponseError('player-list', response, `clubs/${clubId}/players`);
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw firebaseRequestError('player-list-response-invalid', error, `clubs/${clubId}/players`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new FirebasePublicationError('player-list-response-invalid', {
        pathRef: protectedIdentifier(`clubs/${clubId}/players`)
      });
    }
    const listedDocuments = getRecordProperty(payload, 'documents');
    if (listedDocuments !== undefined && !Array.isArray(listedDocuments)) {
      throw new FirebasePublicationError('player-list-response-invalid', {
        pathRef: protectedIdentifier(`clubs/${clubId}/players`)
      });
    }
    const documents = Array.isArray(listedDocuments) ? listedDocuments : [];
    stalePaths.push(...documents.flatMap((document) => {
      const documentName = getRecordProperty(document, 'name');
      const documentId = String(documentName || '').split('/').pop() || '';
      const fields = getRecordProperty(document, 'fields');
      const sourceProfile = getRecordProperty(fields, 'sourceProfileId');
      const sourceProfileId = getRecordProperty(sourceProfile, 'stringValue');
      const expectedId = expectedIdsByProfile.get(sourceProfileId);
      return expectedId && expectedId !== documentId && typeof documentName === 'string' ? [documentName] : [];
    }));
    pageToken = String(getRecordProperty(payload, 'nextPageToken') || '');
  } while (pageToken);

  await batchWriteDocuments(projectId, token, stalePaths.map((documentName) => ({ delete: documentName })));
  return stalePaths.length;
}

const reconciledProjectionCollections = Object.freeze([
  'players',
  'games',
  'gameSessions',
  'memberships',
  'waitlists',
  'notifications',
  'tournaments',
  'tournamentInterests'
]);

async function deleteStaleOwnedProjectionDocuments(projectId, token, clubId, expectedIdsByCollection) {
  const stalePaths = [];
  for (const collectionName of reconciledProjectionCollections) {
    const expectedIds = expectedIdsByCollection[collectionName] instanceof Set
      ? expectedIdsByCollection[collectionName]
      : new Set(expectedIdsByCollection[collectionName] || []);
    let pageToken = '';
    do {
      const endpoint = new URL(
        `${restBase(projectId)}/clubs/${encodeURIComponent(clubId)}/${encodeURIComponent(collectionName)}`
      );
      endpoint.searchParams.set('pageSize', '500');
      if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
      const collectionPath = `clubs/${clubId}/${collectionName}`;
      const response = await fetchFirebase(
        'projection-list',
        endpoint.toString(),
        { headers: { authorization: `Bearer ${token}` } },
        collectionPath
      );
      if (!response.ok) {
        throw await firebaseResponseError('projection-list', response, collectionPath);
      }
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw firebaseRequestError('projection-list-response-invalid', error, collectionPath);
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new FirebasePublicationError('projection-list-response-invalid', {
          pathRef: protectedIdentifier(collectionPath)
        });
      }
      const listedDocuments = getRecordProperty(payload, 'documents');
      if (listedDocuments !== undefined && !Array.isArray(listedDocuments)) {
        throw new FirebasePublicationError('projection-list-response-invalid', {
          pathRef: protectedIdentifier(collectionPath)
        });
      }
      for (const document of Array.isArray(listedDocuments) ? listedDocuments : []) {
        const documentName = getRecordProperty(document, 'name');
        const documentId = String(documentName || '').split('/').pop() || '';
        const fields = getRecordProperty(document, 'fields');
        const syncSource = getRecordProperty(getRecordProperty(fields, 'syncSource'), 'stringValue');
        if (
          typeof documentName === 'string' &&
          documentId &&
          syncSource === 'orbit-api' &&
          !expectedIds.has(documentId)
        ) stalePaths.push(documentName);
      }
      pageToken = String(getRecordProperty(payload, 'nextPageToken') || '');
    } while (pageToken);
  }
  await batchWriteDocuments(projectId, token, stalePaths.map((documentName) => ({ delete: documentName })));
  return stalePaths.length;
}

async function publishStateToFirebase(state, options = {}) {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return { ok: false, skipped: true, reason: 'missing-service-account' };

  const projectId = serviceAccount.project_id || firebaseConfig.projectId;
  const token = await getServiceAccountToken(serviceAccount);
  const accountKey = getAccountKeyFromState(state);
  const snapshot = buildPlayerClubSnapshot(state);
  const savedAt = String(options.savedAt || new Date().toISOString());
  const syncRevision = String(options.syncRevision || `${savedAt}:${crypto.randomUUID()}`);
  const playerDocs = buildCanonicalPlayerDocs(state, accountKey, savedAt);
  const gameDocs = buildPlayerGameDocs(snapshot, accountKey);
  const gameSessionDocs = buildCanonicalGameDocs(state, accountKey, savedAt);
  const tournamentDocs = buildPlayerTournamentDocs(state, accountKey, savedAt);
  const tournamentInterestDocs = buildTournamentInterestDocs(state, accountKey, savedAt);
  const notificationDocs = buildPrivatePlayerNotificationDocs(snapshot, accountKey);
  const syncMetadata = buildSyncMetadata(savedAt, syncRevision, {
    games: gameDocs.length,
    memberships: (snapshot.memberships || []).length,
    waitlists: (snapshot.waitlists || []).length,
    notifications: notificationDocs.length,
    tournaments: tournamentDocs.length,
    tournamentInterests: tournamentInterestDocs.length,
    players: playerDocs.length
  });
  const clubDoc = {
    ...buildCanonicalClubDoc(state, accountKey, snapshot, playerDocs, savedAt),
    social: snapshot.social,
    generatedAt: snapshot.generatedAt,
    savedAt,
    ...syncMetadata
  };

  const writes = [buildBatchUpdate(projectId, `clubStates/${accountKey}`, {
    accountKey,
    schemaVersion: 5,
    savedAt,
    syncProtocolVersion: orbitSyncProtocolVersion,
    syncRevision,
    syncSource: 'orbit-api',
    deprecated: true,
    updatedAt: savedAt
  })];
  writes.push(...playerDocs.map((player) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/players/${firestoreDocumentId(player.id)}`,
    { ...player, ...syncMetadata }
  )));
  writes.push(...gameDocs.map((game) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/games/${firestoreDocumentId(game.id)}`,
    { ...game, ...syncMetadata, updatedAt: savedAt }
  )));
  writes.push(...gameSessionDocs.map((gameSession) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/gameSessions/${firestoreDocumentId(gameSession.id)}`,
    { ...gameSession, ...syncMetadata }
  )));
  writes.push(...(snapshot.memberships || []).map((membership) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/memberships/${firestoreDocumentId(membership.playerId || membership.id)}`,
    { ...membership, ...syncMetadata, updatedAt: savedAt }
  )));
  writes.push(...(snapshot.waitlists || []).map((waitlist) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/waitlists/${firestoreDocumentId(waitlist.id)}`,
    { ...waitlist, ...syncMetadata, updatedAt: savedAt }
  )));
  writes.push(...notificationDocs.map((notification) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/notifications/${firestoreDocumentId(notification.id)}`,
    { ...notification, ...syncMetadata, updatedAt: savedAt }
  )));
  writes.push(...tournamentDocs.map((tournament) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/tournaments/${firestoreDocumentId(tournament.id)}`,
    { ...tournament, ...syncMetadata }
  )));
  writes.push(...tournamentInterestDocs.map((interest) => buildBatchUpdate(
    projectId,
    `clubs/${accountKey}/tournamentInterests/${firestoreDocumentId(interest.id)}`,
    { ...interest, ...syncMetadata }
  )));

  const publicationWriteCount = await batchWriteDocuments(projectId, token, writes);
  const staleProjectionDocumentsRemoved = await deleteStaleOwnedProjectionDocuments(
    projectId,
    token,
    accountKey,
    {
      players: new Set(playerDocs.map((player) => firestoreDocumentId(player.id))),
      games: new Set(gameDocs.map((game) => firestoreDocumentId(game.id))),
      gameSessions: new Set(gameSessionDocs.map((gameSession) => firestoreDocumentId(gameSession.id))),
      memberships: new Set((snapshot.memberships || []).map((membership) =>
        firestoreDocumentId(membership.playerId || membership.id)
      )),
      waitlists: new Set((snapshot.waitlists || []).map((waitlist) => firestoreDocumentId(waitlist.id))),
      notifications: new Set(notificationDocs.map((notification) => firestoreDocumentId(notification.id))),
      tournaments: new Set(tournamentDocs.map((tournament) => firestoreDocumentId(tournament.id))),
      tournamentInterests: new Set(tournamentInterestDocs.map((interest) => firestoreDocumentId(interest.id)))
    }
  );
  const legacyPlayersRemoved = await deleteLegacyPlayerDocuments(projectId, token, accountKey, playerDocs);

  // The parent club document is the commit marker. Publishing it last prevents
  // mobile clients from promoting a partially written child revision.
  await patchDocument(projectId, token, `clubs/${encodeURIComponent(accountKey)}`, clubDoc);

  return {
    ok: true,
    accountKey,
    savedAt,
    syncRevision,
    players: playerDocs.length,
    games: gameDocs.length,
    gameSessions: gameSessionDocs.length,
    tournaments: tournamentDocs.length,
    tournamentInterests: tournamentInterestDocs.length,
    publicationWriteCount: publicationWriteCount + 1 + staleProjectionDocumentsRemoved + legacyPlayersRemoved,
    staleProjectionDocumentsRemoved,
    legacyPlayersRemoved
  };
}

module.exports = {
  FirebasePublicationError,
  batchWriteDocuments,
  buildBatchUpdate,
  buildPlayerGameDocs,
  buildSyncMetadata,
  buildCanonicalClubDoc,
  buildCanonicalPlayerDocs,
  buildPrivatePlayerNotificationDocs,
  buildPlayerTournamentDocs,
  buildTournamentInterestDocs,
  deleteStaleOwnedProjectionDocuments,
  getFirebasePublisherStatus,
  playerDocumentId,
  patchDocument,
  publishStateToFirebase
};
