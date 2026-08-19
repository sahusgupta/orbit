const crypto = require('crypto');
const fs = require('fs');
const { buildPlayerClubSnapshot, getAccountKeyFromState } = require('./orbitCore');

const firebaseConfig = {
  projectId: 'tabletalk-s'
};
const orbitSyncProtocolVersion = 2;

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
      error: error instanceof Error ? error.message : 'Invalid Firebase credentials.'
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
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`
    })
  });
  if (!response.ok) throw new Error(`Firebase token request failed: ${response.status} ${await response.text()}`);
  const accessToken = getRecordProperty(await response.json(), 'access_token');
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
  const roomHourlyFee = Number(state.settings?.defaultHourlyFee ?? legacyRoomProfile?.hourlyFee ?? 0);
  return {
    ...(configuredProfile || {}),
    gameId,
    collectionMode: configuredProfile?.collectionMode || state.settings?.defaultCollectionMode || 'Drop',
    hourlyFee: Number.isFinite(roomHourlyFee) ? roomHourlyFee : 0,
    estimatedDropPerSeatHour: Number(
      configuredProfile?.estimatedDropPerSeatHour ?? state.settings?.defaultEstimatedDropPerSeatHour ?? 0
    )
  };
}

function getSessionSeatHours(state, session) {
  return (state.playerSessions || [])
    .filter((playerSession) => playerSession.tableId === session.id)
    .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0);
}

function getPlayerSessionsForProfile(state, profile) {
  const profileName = String(profile?.name || '').trim().toLowerCase();
  return (state.playerSessions || []).filter((session) =>
    profile?.id
      ? session.profileId === profile.id
      : String(session.playerName || '').trim().toLowerCase() === profileName
  );
}

function getSessionBuyInsForPlayer(state, playerSession) {
  return (state.buyIns || []).filter((buyIn) =>
    buyIn.tableId === playerSession.tableId &&
    buyIn.gameId === playerSession.gameId &&
    (playerSession.profileId
      ? buyIn.profileId === playerSession.profileId
      : String(buyIn.playerName || '').trim().toLowerCase() === String(playerSession.playerName || '').trim().toLowerCase())
  );
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
    const mode = session.collectionMode || (session.timeFeeBased ? 'Time' : profile.collectionMode);
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
  return [...modes][0] || state.settings?.defaultCollectionMode || 'Drop';
}

function buildCanonicalPlayerDocs(state, clubId, savedAt) {
  return (state.profiles || []).map((profile) => {
    const sessions = getPlayerSessionsForProfile(state, profile);
    const firstSessionDate = sessions.map((session) => session.seatedAt).filter(Boolean).sort()[0] || '';
    const totalHoursPlayed = Number(profile.totalTimePlayedHours || 0) || sessions.reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt), 0);
    const contribution = getPlayerContribution(state, sessions);
    const id = playerDocumentId(profile, clubId);
    return {
      id,
      sourceProfileId: profile.id || '',
      name: profile.name || '',
      dateJoined: profile.membershipStartDate || firstSessionDate.slice(0, 10),
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
  return {
    id: clubId,
    name: account.clubName || snapshot.club.name || 'Local Poker Club',
    address: account.address || '',
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

function buildPrivatePlayerNotificationDocs(snapshot, clubId) {
  return (snapshot.notifications || []).flatMap((notification) => {
    const targetPlayerIds = Array.from(new Set(
      (Array.isArray(notification.targetPlayerIds) ? notification.targetPlayerIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    ));
    if (!targetPlayerIds.length) return [];
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

function buildPlayerTournamentDocs(state, clubId, savedAt) {
  return (state.tournaments || []).map((tournament) => {
    const startsAt = tournament.scheduledAt || tournament.startedAt || tournament.createdAt || savedAt;
    const players = tournament.players || [];
    const prizePool = players.reduce((sum, player) =>
      sum + Number(player.buyIn ?? tournament.buyIn ?? 0)
        + Number(player.rebuys || 0) * Number(tournament.rebuyPrice ?? tournament.buyIn ?? 0)
        + Number(player.addOns || 0) * Number(tournament.addOnPrice ?? tournament.buyIn ?? 0), 0);
    return {
      id: firestoreDocumentId(tournament.id),
      clubId,
      name: tournament.name || 'Tournament',
      startsAt,
      registrationOpensAt: tournament.registrationOpensAt || tournament.createdAt || savedAt,
      registrationClosesAt: tournament.registrationClosesAt || startsAt,
      registrationStatus: tournament.registrationStatus || (tournament.status === 'Draft' ? 'open' : 'closed'),
      buyIn: Number(tournament.buyIn || 0),
      prizePoolLabel: tournament.prizePoolLabel || (prizePool ? `$${prizePool.toLocaleString()} current prize pool` : 'Prize pool updates as entries are recorded'),
      startingStack: Number(tournament.startingStack || 0),
      levelMinutes: Number(tournament.levels?.[0]?.durationMinutes || 20),
      lateRegistrationThroughLevel: Number(tournament.lateRegistrationThroughLevel || 0),
      rebuyPrice: Number(tournament.rebuyPrice ?? tournament.buyIn ?? 0),
      rebuyStack: Number(tournament.rebuyStack ?? tournament.startingStack ?? 0),
      unlimitedRebuys: Boolean(tournament.unlimitedRebuys ?? tournament.rebuyPrice),
      addOnPrice: Number(tournament.addOnPrice || 0),
      addOnStack: Number(tournament.addOnStack ?? tournament.startingStack ?? 0),
      rules: tournament.rules || ['House rules and staff decisions are final.'],
      unregisterAllowed: tournament.unregisterAllowed ?? tournament.status === 'Draft',
      entrantCount: players.length,
      totalRebuys: players.reduce((sum, player) => sum + Number(player.rebuys || 0), 0),
      totalAddOns: players.reduce((sum, player) => sum + Number(player.addOns || 0), 0),
      featured: Boolean(tournament.featured),
      updatedAt: savedAt
    };
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
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ writes: writes.slice(offset, offset + chunkSize) })
      }
    );
    if (!response.ok) throw new Error(`Firestore batch write failed: ${response.status} ${await response.text()}`);
  }
  return writes.length;
}

async function patchDocument(projectId, token, path, record) {
  const response = await fetch(`${restBase(projectId)}/${path}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ fields: jsToFirestoreFields(record) })
  });
  if (!response.ok) throw new Error(`Firestore write failed for ${path}: ${response.status} ${await response.text()}`);
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
    const response = await fetch(endpoint.toString(), { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Firestore player listing failed for ${clubId}: ${response.status} ${await response.text()}`);
    const payload = await response.json();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error(`Firestore player listing returned an invalid payload for ${clubId}.`);
    }
    const listedDocuments = getRecordProperty(payload, 'documents');
    if (listedDocuments !== undefined && !Array.isArray(listedDocuments)) {
      throw new Error(`Firestore player listing returned an invalid document list for ${clubId}.`);
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
  const notificationDocs = buildPrivatePlayerNotificationDocs(snapshot, accountKey);
  const syncMetadata = buildSyncMetadata(savedAt, syncRevision, {
    games: gameDocs.length,
    memberships: (snapshot.memberships || []).length,
    waitlists: (snapshot.waitlists || []).length,
    notifications: notificationDocs.length,
    tournaments: tournamentDocs.length,
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
  for (const tournament of state.tournaments || []) {
    for (const player of tournament.players || []) {
      if (!player.registrationId) continue;
      const status = player.status === 'Checked In' || player.status === 'Active'
        ? 'checked-in'
        : player.status === 'Eliminated'
          ? 'eliminated'
          : player.status === 'Finished'
            ? 'finished'
            : 'registered';
      writes.push(buildBatchUpdate(
        projectId,
        `clubs/${accountKey}/tournamentRegistrations/${firestoreDocumentId(player.registrationId)}`,
        {
          id: player.registrationId,
          tournamentId: tournament.id,
          clubId: accountKey,
          playerId: player.profileId || '',
          playerName: player.name || '',
          playerEmail: player.email || '',
          status,
          rebuys: Number(player.rebuys || 0),
          addOns: Number(player.addOns || 0),
          registeredAt: player.registeredAt || savedAt,
          unregisterAllowed: tournament.status === 'Draft',
          ...syncMetadata,
          updatedAt: savedAt
        }
      ));
    }
  }

  const publicationWriteCount = await batchWriteDocuments(projectId, token, writes);
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
    publicationWriteCount: publicationWriteCount + 1 + legacyPlayersRemoved,
    legacyPlayersRemoved
  };
}

module.exports = {
  batchWriteDocuments,
  buildBatchUpdate,
  buildPlayerGameDocs,
  buildSyncMetadata,
  buildCanonicalClubDoc,
  buildCanonicalPlayerDocs,
  buildPrivatePlayerNotificationDocs,
  buildPlayerTournamentDocs,
  getFirebasePublisherStatus,
  playerDocumentId,
  publishStateToFirebase
};
