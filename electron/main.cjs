const { app, autoUpdater: nativeAutoUpdater, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const branding = require('../branding.config.json');
const {
  fetchPendingPlayerRequests,
  isFirebaseConfigured,
  markPlayerRequestApplied,
  readStateFromFirebase,
  writeStateToFirebase
} = require('./firebaseSync.cjs');
const { createLocalStore } = require('./localStore.cjs');
const { createOrbitApiClient } = require('./orbitApiClient.cjs');
const {
  getAccountKeyFromAccess,
  getAccountKeyFromState,
  getRecordProperty,
  isRecord,
  normalizeTextMessageBatch,
  orbitApiErrorDetails,
  sanitizeAccountKey,
  validateStatePayload
} = require('./runtimeUtils.cjs');

const isDev = process.env.ELECTRON_DEV === 'true';
const updateCheckIntervalMs = 30 * 60 * 1000;

if (process.env.TABLEMANAGER_USER_DATA_DIR) {
  app.setPath('userData', process.env.TABLEMANAGER_USER_DATA_DIR);
}

app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disk-cache-size', '0');

const windows = new Map();
const validRoutes = new Set(['floor', 'table', 'builder', 'profiles', 'signals', 'summary', 'customization', 'kpis', 'tournaments', 'tournament-tv', 'pilot', 'outreach']);
let embeddedBackend;
let embeddedBackendStatus = { running: false, host: '127.0.0.1', port: 0, reportCount: 0 };
let updateCheckTimer;
let updateInstallPending = false;
let updateInstallStarted = false;
const pendingUpdateStateFlushes = new Map();
let appStartedAt = new Date().toISOString();
let lastUpdateProgressBucket = -1;

function writeOrbitApiLog(level, event, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details
  };
  const message = `[orbit-api] ${JSON.stringify(entry)}`;
  const logger = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
  logger(message);
  try {
    const logPath = path.join(app.getPath('userData'), 'orbit-api.log');
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 2 * 1024 * 1024) {
      fs.copyFileSync(logPath, `${logPath}.previous`);
      fs.truncateSync(logPath, 0);
    }
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Console logging remains available if the packaged log file cannot be written.
  }
}

function openTrustedExternal(url) {
  try {
    const parsed = new URL(url);
    if (['https:', 'http:', 'mailto:'].includes(parsed.protocol)) {
      shell.openExternal(url);
    }
  } catch {
    // Ignore malformed external links.
  }
}

function getTwilioConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const apiKeySid = process.env.TWILIO_API_KEY_SID || '';
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_API_SECRET || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || process.env.TWILIO_API_KEY || '';
  const from = process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_MESSAGING_FROM || '';
  const username = apiKeySid || accountSid;
  const password = apiKeySid ? apiKeySecret : authToken;

  if (!accountSid || !username || !password || !from) {
    return {
      ok: false,
      error: 'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET, and TWILIO_FROM_NUMBER.'
    };
  }

  return { ok: true, accountSid, username, password, from };
}

async function sendTwilioTextMessage(config, message) {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    To: message.to,
    From: config.from,
    Body: message.body
  });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const responseMessage = getRecordProperty(result, 'message');
    throw new Error(responseMessage ? String(responseMessage) : `Twilio returned ${response.status}.`);
  }
  return result;
}

async function sendTextMessages(payload) {
  const config = getTwilioConfig();
  if (!config.ok) return { ok: false, sent: 0, error: config.error };

  const messages = normalizeTextMessageBatch(payload);
  if (!messages.length) return { ok: true, sent: 0, skipped: 0 };

  const results = await Promise.allSettled(messages.map((message) => sendTwilioTextMessage(config, message)));
  const sent = results.filter((result) => result.status === 'fulfilled').length;
  const firstFailure = results.find((result) => result.status === 'rejected');
  const error = firstFailure?.status === 'rejected'
    ? firstFailure.reason?.message || 'One or more Twilio messages failed.'
    : undefined;

  sendClientEvent('player-outreach-texts', 'outreach', {
    sent,
    requested: messages.length,
    reason: messages[0]?.reason || '',
    gameId: messages[0]?.gameId || '',
    failed: messages.length - sent
  });

  return {
    ok: sent > 0 && sent === messages.length,
    sent,
    skipped: messages.length - sent,
    error
  };
}

const {
  closeDatabase,
  getReportCount,
  readLocalDatabase,
  storeAnalyticalReport,
  writeLocalDatabase
} = createLocalStore({
  app,
  updateBackendReportCount: (reportCount) => {
    embeddedBackendStatus = { ...embeddedBackendStatus, reportCount };
    return embeddedBackendStatus;
  }
});

const activeWaitlistStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const playerVisibleWaitlistStatuses = new Set([
  ...activeWaitlistStatuses,
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated'
]);
const visibleTableStatuses = new Set(['Running', 'Forming', 'Paused']);

function getPlayerLoyalty(clubId, lifetimeHours = 0) {
  const hours = Math.max(0, Number(lifetimeHours) || 0);
  if (hours >= 120) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Anchor', nextTierAtHours: null };
  if (hours >= 50) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Preferred', nextTierAtHours: 120 };
  if (hours >= 12) return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'Regular', nextTierAtHours: 50 };
  return { clubId, points: Math.floor(hours * 10), lifetimeHours: hours, tier: 'New', nextTierAtHours: 12 };
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
  expires.setDate(expires.getDate() + (Number.isFinite(Number(request.membershipDurationDays)) ? Math.max(1, Number(request.membershipDurationDays)) : plan === 'day' ? 1 : 30));
  return { plan, paymentMethod, status: active ? 'Active' : 'Requested', requestedAt,
    startDate: active ? start.toISOString().slice(0, 10) : '',
    expirationDate: active ? expires.toISOString().slice(0, 10) : '',
    expiresAt: active ? expires.toISOString() : undefined };
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

function buildPlayerClubSnapshot(state, player) {
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
    if (!player?.id && !player?.name) return true;
    const playerId = String(player?.id || '').trim().toLowerCase();
    const targetIds = (notification.targetPlayerIds || []).map((target) => String(target).trim().toLowerCase());
    const targetNames = (notification.targetPlayerNames || []).map((target) => String(target).trim().toLowerCase());
    return Boolean(playerId && targetIds.includes(playerId)) || Boolean(playerName && targetNames.includes(playerName));
  });
  const memberships = (state.profiles || [])
    .filter((profile) => {
      if (!player?.id && !player?.name) return true;
      return profile.id === player.id || String(profile.name || '').toLowerCase() === String(player.name || '').toLowerCase();
    })
    .map((profile) => ({
      id: `${clubId}:${profile.id}`,
      clubId,
      playerId: profile.id,
      playerName: profile.name,
      status: profile.membershipStatus === 'Requested' ? 'Requested' : isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate) ? 'Active' : 'Expired',
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
      phone: account.phone,
      membershipOptions: (state.settings?.membershipPlans || [])
        .filter((plan) => plan.active !== false)
        .map(({ id, name, priceLabel, durationDays, description }) => ({ id, name, priceLabel, durationDays, description }))
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
              membershipPlanName: request.planName,
              membershipDurationDays: request.membershipDurationDays,
              preferredGameId: player.preferredGameIds?.[0] || profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...(player.preferredGameIds || [])]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability,
              phone: player.phone || profile.phone,
              notes: appendSyncNote(profile.notes, membership.status === 'Requested' ? `Player app: ${membership.plan} pass requested; pay in person (${player.email || player.id})` : `Player app: ${membership.plan} pass paid in app (${player.email || player.id})`)
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
        id: player.id || crypto.randomUUID(),
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
        membershipPlanName: request.planName,
        membershipDurationDays: request.membershipDurationDays,
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
          preferredGameIds: mergeUnique([...(candidate.preferredGameIds || []), request.gameId]),
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
        id: request.id || crypto.randomUUID(),
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
          status === 'Arrived' ? `At club now; seat requested for ${requestedTable?.label || 'open table'}` : status === 'Confirmed Coming' ? `Confirmed coming${request.expectedArrivalTime ? ` at ${request.expectedArrivalTime}` : ''}` : `Interested${request.availabilityStartTime ? ` from ${request.availabilityStartTime}${request.availabilityEndTime ? ` to ${request.availabilityEndTime}` : ''}` : ''}`,
          request.note
        ].filter(Boolean).join(' | ')
      }
    ]
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

async function syncStateWithFirebaseRequests(state) {
  if (!isFirebaseConfigured()) return state;
  const accountKey = getAccountKeyFromState(state);
  let pending;
  try {
    pending = await fetchPendingPlayerRequests(accountKey);
  } catch {
    return state;
  }
  let nextState = state;

  for (const request of pending.membershipRequests) {
    nextState = applyMembershipRequestToState(nextState, request);
    await markPlayerRequestApplied(accountKey, 'membership', request.id);
  }

  for (const request of pending.waitlistRequests) {
    nextState = applyWaitlistRequestToState(nextState, request);
    await markPlayerRequestApplied(accountKey, 'waitlist', request.id);
  }

  return nextState;
}

async function loadStateWithFirebaseFallback(accountKey) {
  const localRecord = readLocalDatabase(accountKey);
  let record = localRecord;
  if (!record?.state && isFirebaseConfigured()) {
    try {
      record = await readStateFromFirebase(sanitizeAccountKey(accountKey));
    } catch {
      record = localRecord;
    }
  }
  if (!record?.state) return record;
  const syncedState = await syncStateWithFirebaseRequests(record.state);
  if (syncedState === record.state) return record;
  await saveStateEverywhere(syncedState);
  return {
    schemaVersion: record.schemaVersion || 4,
    savedAt: new Date().toISOString(),
    state: syncedState
  };
}

async function saveStateEverywhere(state) {
  const localResult = writeLocalDatabase(state);
  if (!isFirebaseConfigured()) return localResult;
  const accountKey = getAccountKeyFromState(state);
  const publicSnapshot = buildPlayerClubSnapshot(state);
  try {
    writeStateToFirebase(accountKey, state, publicSnapshot).catch(() => undefined);
  } catch {
    // Cloud sync must never block local persistence.
  }
  return {
    ...localResult,
    firebase: { ok: true, engine: 'firebase', accountKey, pending: true }
  };
}

const {
  getClientUpdateState,
  getRemoteBackendStatus,
  loadStateApiFirst,
  saveStateApiFirst,
  saveStateToApi,
  sendClientError,
  sendClientEvent,
  sendClientUpdateEvent,
  startClientTelemetry,
  stopClientTelemetry,
  submitAnalyticalReportApiFirst,
  validatePilotAccessApi
} = createOrbitApiClient({
  app,
  buildPlayerClubSnapshot,
  getAppStartedAt: () => appStartedAt,
  isDev,
  isFirebaseConfigured,
  loadStateWithFirebaseFallback,
  readLocalDatabase,
  saveStateEverywhere,
  storeAnalyticalReport,
  writeLocalDatabase,
  writeOrbitApiLog,
  writeStateToFirebase
});

function startEmbeddedBackend() {
  if (embeddedBackend) return;

  embeddedBackend = http.createServer(async (request, response) => {
    try {
      const remoteAddress = request.socket.remoteAddress;
      const isLoopback = remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1';
      const allowLanPlayerSync = process.env.TABLEMANAGER_PLAYER_SYNC_ALLOW_LAN === 'true';
      if (!isLoopback && !allowLanPlayerSync) {
        sendJson(response, 403, { ok: false, error: 'Embedded backend only accepts loopback requests.' });
        return;
      }

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }

      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);

      if (request.method === 'GET' && requestUrl.pathname === '/health') {
        sendJson(response, 200, { ok: true, ...embeddedBackendStatus, reportCount: getReportCount() });
        return;
      }

      if (request.method === 'GET' && requestUrl.pathname === '/player/snapshot') {
        const accountKey = sanitizeAccountKey(requestUrl.searchParams.get('accountKey') || '');
        const record = await loadStateWithFirebaseFallback(accountKey);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No Orbit club database is available yet.' });
          return;
        }
        const syncedState = await syncStateWithFirebaseRequests(record.state);
        if (syncedState !== record.state) {
          await saveStateEverywhere(syncedState);
        }
        const player = {
          id: requestUrl.searchParams.get('playerId') || '',
          name: requestUrl.searchParams.get('playerName') || ''
        };
        sendJson(response, 200, {
          ok: true,
          accountKey: getAccountKeyFromState(syncedState),
          savedAt: record.savedAt,
          snapshot: buildPlayerClubSnapshot(syncedState, player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/player/membership-requests') {
        const requestPayload = JSON.parse(await readRequestBody(request));
        const record = await loadStateWithFirebaseFallback(requestPayload.clubId);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No matching club database was found for this membership request.' });
          return;
        }
        const nextState = applyMembershipRequestToState(record.state, requestPayload);
        await saveStateEverywhere(nextState);
        sendJson(response, 201, {
          ok: true,
          accountKey: getAccountKeyFromState(nextState),
          snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/player/waitlist-requests') {
        const requestPayload = JSON.parse(await readRequestBody(request));
        const record = await loadStateWithFirebaseFallback(requestPayload.clubId);
        if (!record?.state) {
          sendJson(response, 404, { ok: false, error: 'No matching club database was found for this waitlist request.' });
          return;
        }
        const nextState = applyWaitlistRequestToState(record.state, requestPayload);
        await saveStateEverywhere(nextState);
        sendJson(response, 201, {
          ok: true,
          accountKey: getAccountKeyFromState(nextState),
          snapshot: buildPlayerClubSnapshot(nextState, requestPayload.player)
        });
        return;
      }

      if (request.method === 'POST' && requestUrl.pathname === '/analytical-reports') {
        const body = await readRequestBody(request);
        const result = await storeAnalyticalReport(JSON.parse(body));
        sendJson(response, 201, result);
        return;
      }

      sendJson(response, 404, { ok: false, error: 'Not found.' });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : 'Request failed.' });
    }
  });

  const configuredPort = Number(process.env.TABLEMANAGER_SYNC_PORT || process.env.TABLEMANAGER_BACKEND_PORT || 4629);
  const configuredHost = process.env.TABLEMANAGER_SYNC_HOST || '127.0.0.1';

  embeddedBackend.listen(configuredPort, configuredHost, () => {
    const address = embeddedBackend.address();
    embeddedBackendStatus = {
      running: true,
      host: configuredHost,
      port: typeof address === 'object' && address ? address.port : 0,
      reportCount: getReportCount()
    };
  });

  embeddedBackend.on('close', () => {
    embeddedBackendStatus = { ...embeddedBackendStatus, running: false, port: 0 };
  });
}

function broadcastUpdateStatus(status) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('update-status', status);
    }
  }
}

async function preserveRendererStateBeforeUpdate() {
  const availableWindows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed());
  const authoritativeWindow = windows.get('floor') || BrowserWindow.getFocusedWindow() || availableWindows[0];
  if (!authoritativeWindow || authoritativeWindow.isDestroyed()) return;

  await new Promise((resolve) => {
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      pendingUpdateStateFlushes.delete(requestId);
      writeOrbitApiLog('warn', 'update-state-flush-timed-out', { requestId });
      resolve(false);
    }, 15 * 1000);
    pendingUpdateStateFlushes.set(requestId, (ok) => {
      clearTimeout(timeout);
      pendingUpdateStateFlushes.delete(requestId);
      resolve(ok);
    });
    authoritativeWindow.webContents.send('prepare-for-update', requestId);
  });
}

async function installDownloadedUpdate() {
  if (!updateInstallPending || updateInstallStarted) return;
  updateInstallStarted = true;
  sendClientUpdateEvent('update-preserving-state', 'downloaded');
  broadcastUpdateStatus({ state: 'preserving-state' });
  await preserveRendererStateBeforeUpdate();
  updateInstallPending = false;
  sendClientUpdateEvent('update-installing-automatically', 'installing');
  broadcastUpdateStatus({ state: 'installing' });
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 3000);
}

function startAutoUpdates() {
  if (isDev || !app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('checking-for-update', () => {
    sendClientUpdateEvent('checking-for-update', 'checking');
    broadcastUpdateStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    sendClientUpdateEvent('update-available', 'available', { version: info.version });
    broadcastUpdateStatus({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', (info) => {
    sendClientUpdateEvent('update-not-available', 'current', { version: info.version });
    broadcastUpdateStatus({ state: 'current', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    const progressBucket = Math.floor(Math.round(progress.percent ?? 0) / 25);
    if (progressBucket !== lastUpdateProgressBucket) {
      lastUpdateProgressBucket = progressBucket;
      sendClientEvent('update-download-progress', 'update', { percent: Math.round(progress.percent ?? 0) });
    }
    broadcastUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent ?? 0) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    lastUpdateProgressBucket = -1;
    sendClientUpdateEvent('update-downloaded', 'downloaded', { version: info.version });
    broadcastUpdateStatus({ state: 'downloaded', version: info.version });
    updateInstallPending = true;
    void installDownloadedUpdate();
  });
  nativeAutoUpdater.on('before-quit-for-update', () => {
    sendClientEvent('update-installing', 'update', getClientUpdateState());
  });
  autoUpdater.on('error', (error) => {
    lastUpdateProgressBucket = -1;
    const message = error instanceof Error ? error.message : 'Update check failed.';
    sendClientUpdateEvent('update-error', 'error', { message });
    broadcastUpdateStatus({ state: 'error', message });
  });

  const checkForUpdates = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((error) => {
      const message = error instanceof Error ? error.message : 'Update check failed.';
      sendClientUpdateEvent('update-error', 'error', { message });
      broadcastUpdateStatus({ state: 'error', message });
    });
  };

  checkForUpdates();
  updateCheckTimer = setInterval(checkForUpdates, updateCheckIntervalMs);
}

ipcMain.handle('open-route-window', (_event, route, context = {}) => {
  const normalizedRoute = route === 'outreach' ? 'signals' : validRoutes.has(route) ? route : 'floor';
  createWindow(normalizedRoute, context);
});

ipcMain.handle('load-state', async () => loadStateApiFirst());

ipcMain.handle('load-state-for-account', async (_event, access) => loadStateApiFirst(getAccountKeyFromAccess(access), access));

ipcMain.handle('save-state', async (_event, state) => saveStateApiFirst(state));

ipcMain.handle('preserve-state-for-update', async (_event, requestId, state) => {
  let ok = false;
  try {
    validateStatePayload(state);
    writeLocalDatabase(state);
    ok = true;
    void saveStateToApi(state).catch((error) => {
      writeOrbitApiLog('warn', 'update-cloud-state-flush-failed', orbitApiErrorDetails(error));
    });
  } catch (error) {
    writeOrbitApiLog('error', 'update-local-state-flush-failed', orbitApiErrorDetails(error));
  }
  pendingUpdateStateFlushes.get(requestId)?.(ok);
  return { ok };
});

ipcMain.handle('get-backend-status', async () =>
  (await getRemoteBackendStatus()) || { ...embeddedBackendStatus, reportCount: getReportCount(), mode: embeddedBackendStatus.running ? 'legacy-embedded' : 'local-fallback' }
);

ipcMain.handle('validate-pilot-access', async (_event, access) => validatePilotAccessApi(access));

ipcMain.handle('submit-analytical-report', (_event, report) => submitAnalyticalReportApiFirst(report));

ipcMain.handle('send-text-messages', (_event, payload) => sendTextMessages(payload));

ipcMain.handle('record-client-event', (_event, event, category, details, route) => {
  sendClientEvent(event, category, details, { route });
  return { ok: true };
});

ipcMain.handle('record-client-error', (_event, payload = {}) => {
  sendClientError(new Error(payload.message || 'Renderer error'), payload.source || 'renderer', {
    route: payload.route || '',
    filename: payload.filename || '',
    line: payload.line || 0,
    column: payload.column || 0,
    details: payload.details || null,
    rendererStack: payload.stack || ''
  });
  return { ok: true };
});

function loadRoute(window, route, context = {}) {
  const query = route === 'table' && context.sessionId
    ? `sessionId=${encodeURIComponent(context.sessionId)}`
    : route === 'tournament-tv' && context.tournamentId
      ? `tournamentId=${encodeURIComponent(context.tournamentId)}`
      : '';
  const hash = `/${route}${query ? `?${query}` : ''}`;
  if (isDev) {
    window.loadURL(`http://127.0.0.1:5173/#${hash}`);
    return;
  }

  window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
    hash
  });
}

function createWindow(route = 'floor', context = {}) {
  const windowKey = route === 'table' && context.sessionId
    ? `table:${context.sessionId}`
    : route === 'tournament-tv' && context.tournamentId
      ? `tournament-tv:${context.tournamentId}`
      : route;
  const existing = windows.get(windowKey);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return existing;
  }

  const routeConfig = {
    floor: { width: 1280, height: 860, minWidth: 1040, minHeight: 720, title: branding.desktop.windowTitles.floor },
    table: { width: 1440, height: 940, minWidth: 1180, minHeight: 760, title: 'Table View' },
    builder: { width: 920, height: 760, minWidth: 760, minHeight: 620, title: branding.desktop.windowTitles.builder },
    profiles: { width: 940, height: 760, minWidth: 760, minHeight: 620, title: branding.desktop.windowTitles.profiles },
    signals: { width: 980, height: 780, minWidth: 780, minHeight: 640, title: branding.desktop.windowTitles.signals },
    summary: { width: 1040, height: 820, minWidth: 820, minHeight: 640, title: branding.desktop.windowTitles.summary },
    customization: { width: 920, height: 700, minWidth: 760, minHeight: 600, title: branding.desktop.windowTitles.customization ?? 'Customization' },
    kpis: { width: 860, height: 620, minWidth: 720, minHeight: 520, title: branding.desktop.windowTitles.kpis ?? 'KPIs' },
    tournaments: { width: 1180, height: 820, minWidth: 940, minHeight: 680, title: 'Tournament Manager' },
    'tournament-tv': { width: 1280, height: 720, minWidth: 960, minHeight: 540, title: 'Tournament TV' },
    pilot: { width: 980, height: 760, minWidth: 780, minHeight: 620, title: branding.desktop.windowTitles.pilot }
  }[route] ?? { width: 900, height: 700, minWidth: 700, minHeight: 560, title: branding.product.name };

  const mainWindow = new BrowserWindow({
    ...routeConfig,
    frame: route !== 'tournament-tv',
    autoHideMenuBar: route === 'tournament-tv',
    titleBarStyle: route === 'tournament-tv' ? 'hidden' : 'default',
    fullscreenable: true,
    backgroundColor: branding.desktop.backgroundColor,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (route === 'tournament-tv') {
    mainWindow.setMenuBarVisibility(false);
    mainWindow.removeMenu();
  }

  mainWindow.once('ready-to-show', () => {
    if (route === 'tournament-tv') {
      mainWindow.setFullScreen(true);
    } else if (route === 'table') {
      mainWindow.maximize();
    }
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openTrustedExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL();
    if (url !== currentUrl && !url.startsWith('file://') && !url.startsWith('http://127.0.0.1:5173/')) {
      event.preventDefault();
      openTrustedExternal(url);
    }
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    sendClientError(new Error(`Renderer process gone: ${details.reason}`), 'renderer-process', {
      route,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  mainWindow.webContents.on('unresponsive', () => {
    sendClientError(new Error('Renderer window became unresponsive'), 'renderer-process', { route });
  });

  mainWindow.on('closed', () => {
    windows.delete(windowKey);
  });

  windows.set(windowKey, mainWindow);
  loadRoute(mainWindow, route, context);

  if (isDev && route === 'floor') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

app.whenReady().then(() => {
  appStartedAt = new Date().toISOString();
  if (process.env.ORBIT_ENABLE_EMBEDDED_BACKEND === 'true') {
    startEmbeddedBackend();
  }
  startClientTelemetry();
  startAutoUpdates();

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { role: 'reload' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      {
        label: 'View',
        submenu: [
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ])
  );

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  sendClientEvent('app-closed', 'lifecycle', {
    startedAt: appStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    openWindowCount: BrowserWindow.getAllWindows().length
  });
  stopClientTelemetry();
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = undefined;
  }
  if (embeddedBackend) {
    embeddedBackend.close();
    embeddedBackend = undefined;
  }
  closeDatabase();
});

process.on('uncaughtException', (error) => {
  sendClientError(error, 'main-uncaught-exception');
});

process.on('unhandledRejection', (reason) => {
  sendClientError(reason instanceof Error ? reason : new Error(String(reason)), 'main-unhandled-rejection');
});

