const crypto = require('crypto');
const fs = require('fs');
const { buildPlayerClubSnapshot, getAccountKeyFromState } = require('./orbitCore');

const firebaseConfig = {
  projectId: 'tabletalk-s'
};

function base64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
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
  return (await response.json()).access_token;
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
  return (state.settings?.collectionProfiles || []).find((profile) => profile.gameId === gameId) || {
    gameId,
    collectionMode: state.settings?.defaultCollectionMode || 'Drop',
    hourlyFee: Number(state.settings?.defaultHourlyFee || 0),
    estimatedDropPerSeatHour: Number(state.settings?.defaultEstimatedDropPerSeatHour || 0)
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
      timeFeeContribution += ((Number(playerSession.timePurchasedMinutes || 0) || 0) / 60) * (Number(profile.hourlyFee || 0) || 0);
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

function buildLastSessionSnapshot(state, savedAt) {
  const sorted = [...(state.sessions || [])].sort((left, right) =>
    String(right.endedAt || right.startedAt || '').localeCompare(String(left.endedAt || left.startedAt || ''))
  );
  const session = sorted[0];
  if (!session) return null;
  const game = (state.games || []).find((item) => item.id === session.gameId);
  return {
    savedAt,
    sessionId: session.id,
    gameId: session.gameId,
    gameName: game?.name || session.gameId,
    label: session.label || '',
    status: session.status || '',
    startedAt: session.startedAt || '',
    endedAt: session.endedAt || '',
    playerCount: (state.playerSessions || []).filter((playerSession) => playerSession.tableId === session.id).length,
    downloadPath: `clubStates/${getAccountKeyFromState(state)}`
  };
}

function buildCanonicalClubDoc(state, clubId, snapshot, playerDocs, savedAt) {
  const account = state.settings?.clubAccount || {};
  const access = state.settings?.pilotAccess || {};
  return {
    id: clubId,
    licenseIdentifier: access.licenseId || access.authorizationCode || clubId,
    name: account.clubName || snapshot.club.name || 'Local Poker Club',
    accountName: account.accountName || '',
    contactName: account.contactName || '',
    address: account.address || '',
    phoneNumber: account.phone || '',
    emailAddress: account.email || '',
    gamesOffered: (state.games || []).map((game) => ({
      id: game.id,
      name: game.name,
      maxSeats: game.maxSeats
    })),
    format: getClubFormat(state),
    membershipStartedAt: access.issuedAt || '',
    membershipRenewalDate: access.expiresAt || '',
    membershipTier: access.tier || state.settings?.membershipTier || '',
    playerCount: playerDocs.length,
    activeMembershipCount: playerDocs.filter((player) => player.membershipActive).length,
    lastSessionSnapshot: buildLastSessionSnapshot(state, savedAt),
    snapshotDownloadPath: `clubStates/${clubId}`,
    updatedAt: savedAt
  };
}

function restBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
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

  const endpoint = `${restBase(projectId)}/clubs/${encodeURIComponent(clubId)}/players?pageSize=1000`;
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Firestore player listing failed for ${clubId}: ${response.status} ${await response.text()}`);
  const payload = await response.json();
  const stalePaths = (payload.documents || []).flatMap((document) => {
    const documentId = String(document.name || '').split('/').pop() || '';
    const sourceProfileId = document.fields?.sourceProfileId?.stringValue || '';
    const expectedId = expectedIdsByProfile.get(sourceProfileId);
    return expectedId && expectedId !== documentId ? [document.name] : [];
  });

  for (const documentName of stalePaths) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${documentName}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` }
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Firestore legacy player cleanup failed: ${response.status} ${await response.text()}`);
    }
  }
  return stalePaths.length;
}

async function publishStateToFirebase(state) {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return { ok: false, skipped: true, reason: 'missing-service-account' };

  const projectId = serviceAccount.project_id || firebaseConfig.projectId;
  const token = await getServiceAccountToken(serviceAccount);
  const accountKey = getAccountKeyFromState(state);
  const snapshot = buildPlayerClubSnapshot(state);
  const savedAt = new Date().toISOString();
  const playerDocs = buildCanonicalPlayerDocs(state, accountKey, savedAt);
  const gameDocs = buildCanonicalGameDocs(state, accountKey, savedAt);
  const clubDoc = buildCanonicalClubDoc(state, accountKey, snapshot, playerDocs, savedAt);

  await patchDocument(projectId, token, `clubStates/${encodeURIComponent(accountKey)}`, {
    accountKey,
    schemaVersion: 4,
    savedAt,
    state,
    snapshot,
    updatedAt: savedAt
  });
  await patchDocument(projectId, token, `clubs/${encodeURIComponent(accountKey)}`, clubDoc);

  for (const player of playerDocs) {
    await patchDocument(
      projectId,
      token,
      `clubs/${encodeURIComponent(accountKey)}/players/${encodeURIComponent(player.id)}`,
      player
    );
  }

  const legacyPlayersRemoved = await deleteLegacyPlayerDocuments(projectId, token, accountKey, playerDocs);

  for (const game of gameDocs) {
    await patchDocument(
      projectId,
      token,
      `clubs/${encodeURIComponent(accountKey)}/games/${encodeURIComponent(game.id)}`,
      game
    );
  }

  return { ok: true, accountKey, savedAt, players: playerDocs.length, games: gameDocs.length, legacyPlayersRemoved };
}

module.exports = {
  buildCanonicalClubDoc,
  buildCanonicalPlayerDocs,
  getFirebasePublisherStatus,
  playerDocumentId,
  publishStateToFirebase
};
