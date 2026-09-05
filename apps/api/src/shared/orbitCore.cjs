const activeWaitlistStatuses = new Set(['Interested', 'Confirmed Coming', 'Arrived']);
const playerVisibleWaitlistStatuses = new Set([
  ...activeWaitlistStatuses,
  'Seated',
  'Declined',
  'No-Show',
  'Left Before Seated'
]);
const visibleTableStatuses = new Set(['Running', 'Forming', 'Paused']);

/**
 * @typedef {{
 *   profile?: 'api' | 'electron',
 *   validateState?: boolean,
 *   createId?: () => string
 * }} OrbitCoreOptions
 */

/**
 * @param {OrbitCoreOptions} options
 */
function isElectronProfile(options) {
  return options.profile === 'electron';
}

/**
 * @param {unknown} requestId
 * @param {OrbitCoreOptions} options
 */
function getFallbackId(requestId, options) {
  return isElectronProfile(options) && options.createId ? options.createId() : requestId;
}

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
  const plan = request.plan === 'day' || request.plan === 'monthly' ? request.plan : undefined;
  const paymentMethod = request.paymentMethod === 'app' ? 'app' : 'in-person';
  const paymentStatus = request.membershipPaymentRequired === false ? 'Not required' : 'Pending';
  return {
    plan,
    paymentMethod,
    status: 'Requested',
    paymentStatus,
    requestedAt,
    startDate: '',
    expirationDate: '',
    expiresAt: undefined
  };
}

function getIdentityProfileFields(request, existingProfile = {}) {
  if (existingProfile.identityReviewStatus === 'Approved') return {};
  const identity = isRecord(request.identitySummary) ? request.identitySummary : {};
  return {
    name: String(identity.fullName || request.player?.name || existingProfile.name || 'Player').trim() || 'Player',
    birthday: String(identity.dateOfBirth || existingProfile.birthday || ''),
    address: String(identity.address || existingProfile.address || ''),
    identityCaptureMethod: identity.captureMethod === 'player-camera-pdf417' ? 'player-camera-pdf417' : existingProfile.identityCaptureMethod,
    identityCapturedAt: String(identity.capturedAt || existingProfile.identityCapturedAt || '') || undefined,
    identityReviewStatus: identity.reviewStatus === 'Approved' ? 'Approved' : 'Pending'
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

function matchesAuthenticatedProfile(profile, player) {
  if (!profile || !player) return false;
  const playerId = String(player.id || '').trim();
  return Boolean(playerId && [profile.id, profile.orbitPlayerId]
    .some((value) => String(value || '').trim() === playerId));
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

/** @param {OrbitCoreOptions} [options] */
function buildPlayerClubSnapshot(state, player = {}, options = {}) {
  if (options.validateState !== false) validateStatePayload(state);
  const electronProfile = isElectronProfile(options);
  const clubId = getAccountKeyFromState(state);
  const account = state.settings?.clubAccount || {};
  const activePlayerSessions = (state.playerSessions || []).filter((session) => !session.leftAt);
  const activeAdminCount = (state.settings?.staffAccounts || []).filter((staff) => staff.active !== false).length;
  const requestingProfile = (state.profiles || []).find((profile) => matchesAuthenticatedProfile(profile, player));
  const publishedPlayerId = (profileId) => {
    const profile = (state.profiles || []).find((candidate) => String(candidate.id || '') === String(profileId || ''));
    return String(profile?.orbitPlayerId || profileId || '');
  };
  const knownProfileIds = new Set(requestingProfile?.commonlyPlaysWithProfileIds || []);
  const isKnownPlayerSession = (session) =>
    Boolean(session.profileId && knownProfileIds.has(session.profileId));
  const tables = (state.sessions || [])
    .filter((session) => visibleTableStatuses.has(session.status))
    .map((session) => {
      const seatedSessions = activePlayerSessions.filter((playerSession) => playerSession.tableId === session.id);
      const configuredGameMode = (state.settings?.collectionProfiles || [])
        .find((profile) => profile.gameId === session.gameId)?.collectionMode;
      const collectionMode = session.collectionMode === 'Time' || session.collectionMode === 'Drop'
        ? session.collectionMode
        : session.timeFeeBased === true
          ? 'Time'
          : configuredGameMode === 'Time' || configuredGameMode === 'Drop'
            ? configuredGameMode
            : state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
              ? state.settings.defaultCollectionMode
              : undefined;
      return {
        id: session.id,
        gameId: session.gameId,
        label: session.label,
        status: session.status,
        seatsFilled: Math.min(session.seatsFilled, session.maxSeats),
        maxSeats: session.maxSeats,
        availableSeats: Math.max(0, session.maxSeats - session.seatsFilled),
        ...(collectionMode ? { collectionMode } : {}),
        tags: session.tags || [],
        startedAt: session.startedAt,
        social: {
          seatedPlayerCount: seatedSessions.length || Math.min(session.seatsFilled, session.maxSeats),
          adminCount: activeAdminCount,
          knownPlayersCount: seatedSessions.filter(isKnownPlayerSession).length
        }
      };
    });
  const runningTables = tables.filter((table) => table.status === 'Running');
  const runningTableIds = new Set(runningTables.map((table) => table.id));
  const activeRunningPlayerSessions = activePlayerSessions.filter((session) => runningTableIds.has(session.tableId));
  const allWaitlists = (state.games || [])
    .flatMap((game) => getWaitlistEntriesForGame(state.interests || [], clubId, game.id))
    .map((entry) => ({ ...entry, playerId: publishedPlayerId(entry.playerId) }));
  const authorizedPlayerIds = new Set([
    String(player?.id || ''),
    String(requestingProfile?.id || ''),
    String(requestingProfile?.orbitPlayerId || '')
  ].filter(Boolean));
  const waitlists = player?.id
    ? allWaitlists.filter((entry) => authorizedPlayerIds.has(String(entry.playerId || '')))
    : allWaitlists;
  const notifications = (state.inAppNotifications || [])
    .filter((notification) => {
      if (!Array.isArray(notification.targetPlayerIds) || notification.targetPlayerIds.length !== 1) return false;
      if (!player?.id) return true;
      return (notification.targetPlayerIds || []).some((target) => authorizedPlayerIds.has(String(target)));
    })
    .map((notification) => {
      const { targetPlayerNames: _privateTargetNames, ...publishedNotification } = notification;
      return {
        ...publishedNotification,
        targetPlayerIds: (notification.targetPlayerIds || []).map(publishedPlayerId).filter(Boolean)
      };
    });
  const memberships = (state.profiles || [])
    .filter((profile) => {
      if (!player?.id) return true;
      return matchesAuthenticatedProfile(profile, player);
    })
    .map((profile) => ({
      id: `${clubId}:${publishedPlayerId(profile.id)}`,
      clubId,
      playerId: publishedPlayerId(profile.id),
      playerName: profile.name,
      status: electronProfile
        ? profile.membershipStatus === 'Requested'
          ? 'Requested'
          : isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate) ? 'Active' : 'Expired'
        : profile.membershipStatus === 'Requested' || profile.membershipStatus === 'Approved'
          ? profile.membershipStatus
          : isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate) ? 'Active' : 'Expired',
      ...(profile.membershipStartDate ? { joinedAt: profile.membershipStartDate } : {}),
      expiresAt: electronProfile
        ? profile.membershipExpiresAt || profile.membershipExpirationDate
        : profile.membershipStatus === 'Requested' || profile.membershipStatus === 'Approved'
          ? undefined
          : profile.membershipExpiresAt || profile.membershipExpirationDate,
      plan: profile.membershipPlan,
      planId: profile.membershipPlanId,
      planName: profile.membershipPlanName,
      membershipDurationDays: profile.membershipDurationDays,
      paymentMethod: profile.membershipPaymentMethod,
      paymentStatus: profile.membershipPaymentStatus,
      identityReviewStatus: profile.identityReviewStatus,
      requestedAt: profile.membershipRequestedAt,
      preferredGameIds: profile.preferredGameIds?.length ? profile.preferredGameIds : profile.preferredGameId ? [profile.preferredGameId] : [],
      preferredStakes: profile.preferredStakes,
      clubNote: profile.typicalAvailability
    }));
  const timeCollectionEnabled = state.settings?.defaultCollectionMode === 'Time' ||
    (state.settings?.collectionProfiles || []).some((profile) => profile.collectionMode === 'Time') ||
    tables.some((table) => table.collectionMode === 'Time');
  const linkedPlayerSession = requestingProfile
    ? activePlayerSessions.find((playerSession) => {
        if (playerSession.profileId !== requestingProfile.id) return false;
        return tables.find((table) => table.id === playerSession.tableId)?.collectionMode === 'Time';
      })
    : undefined;
  const linkedTable = linkedPlayerSession ? tables.find((table) => table.id === linkedPlayerSession.tableId) : undefined;
  const linkedGame = linkedPlayerSession ? (state.games || []).find((game) => game.id === linkedPlayerSession.gameId) : undefined;
  const elapsedMinutes = linkedPlayerSession?.timeFeeEnabled && linkedPlayerSession.lastTimeTickAt
    ? Math.max(0, (Date.now() - Date.parse(linkedPlayerSession.lastTimeTickAt)) / 60_000)
    : 0;

  return {
    club: {
      id: clubId,
      name: account.clubName || '',
      address: account.address,
      phone: account.phone,
      ...(account.minimumPlayerAge === 18 || account.minimumPlayerAge === 21
        ? { minimumAge: account.minimumPlayerAge }
        : {}),
      membershipOptions: (state.settings?.membershipPlans || [])
        .filter((plan) => plan.active === true
          && String(plan.id || '').trim()
          && String(plan.name || '').trim()
          && typeof plan.priceLabel === 'string'
          && plan.priceLabel.trim()
          && Number.isInteger(plan.durationDays)
          && plan.durationDays >= 1
          && plan.durationDays <= 3660)
        .map(({ id, name, priceLabel, durationDays, description }) => ({ id, name, priceLabel, durationDays, description }))
    },
    games: (state.games || []).map((game) => {
      const openTables = tables.filter((table) => table.gameId === game.id);
      const runningGameTables = openTables.filter((table) => table.status === 'Running');
      const gameWaitlist = waitlists.filter((entry) => entry.gameId === game.id && activeWaitlistStatuses.has(entry.status));
      const collectionMode = state.settings?.collectionProfiles?.find((profile) => profile.gameId === game.id)?.collectionMode ||
        openTables[0]?.collectionMode ||
        (state.settings?.defaultCollectionMode === 'Time' || state.settings?.defaultCollectionMode === 'Drop'
          ? state.settings.defaultCollectionMode
          : undefined);
      return {
        id: game.id,
        name: game.name,
        maxSeats: game.maxSeats,
        ...(collectionMode ? { collectionMode } : {}),
        openTables,
        waitlistCount: gameWaitlist.length,
        formingCount: openTables.filter((table) => table.status === 'Forming').length,
        availableSeats: runningGameTables.reduce((sum, table) => sum + table.availableSeats, 0),
        knownPlayersCount: runningGameTables.reduce((sum, table) => sum + table.social.knownPlayersCount, 0)
      };
    }),
    memberships,
    waitlists,
    notifications,
    social: {
      activePlayerCount: activeRunningPlayerSessions.length || runningTables.reduce((sum, table) => sum + table.seatsFilled, 0),
      adminCount: activeAdminCount,
      knownPlayersInHouse: activePlayerSessions.filter(isKnownPlayerSession).length,
      waitlistCount: waitlists.filter((entry) => activeWaitlistStatuses.has(entry.status)).length
    },
    ...(timeCollectionEnabled ? { timeAccess: {
      enabled: timeCollectionEnabled,
      ...(typeof state.settings?.defaultHourlyFee === 'number' && Number.isFinite(state.settings.defaultHourlyFee)
        ? { hourlyFeeCents: Math.max(0, Math.round(state.settings.defaultHourlyFee * 100)) }
        : {}),
      linked: Boolean(requestingProfile),
      profileId: requestingProfile?.id,
      savedMinutes: Math.max(0, Math.floor(Number(requestingProfile?.savedTimeCreditMinutes || 0))),
      ...(linkedPlayerSession && linkedTable && linkedGame ? {
        activeSession: {
          id: linkedPlayerSession.id,
          tableId: linkedPlayerSession.tableId,
          tableLabel: linkedTable.label,
          gameId: linkedPlayerSession.gameId,
          gameName: linkedGame.name,
          purchasedMinutes: Math.max(0, Math.floor(Number(linkedPlayerSession.timePurchasedMinutes || 0))),
          remainingMinutes: Math.max(0, Math.ceil(Number(linkedPlayerSession.timeRemainingMinutes || 0) - elapsedMinutes))
        }
      } : {})
    } } : {}),
    generatedAt: new Date().toISOString()
  };
}

/** @param {OrbitCoreOptions} [options] */
function applyMembershipRequestToState(state, request, options = {}) {
  if (options.validateState !== false) validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const existingProfile = (state.profiles || []).find((profile) => matchesAuthenticatedProfile(profile, player));
  const membership = getMembershipWindow(request);
  const preserveCurrentActiveWindow = Boolean(
    existingProfile?.membershipStatus === 'Active' &&
    isFutureDate(existingProfile.membershipExpiresAt || existingProfile.membershipExpirationDate)
  );
  const preserveAuthoritativePayment = Boolean(
    existingProfile?.membershipPaymentStatus === 'Paid' && existingProfile.membershipPaymentTransactionId
  );

  if (existingProfile) {
    return {
      ...state,
      profiles: state.profiles.map((profile) =>
        profile.id === existingProfile.id
          ? {
              ...profile,
              orbitPlayerId: player.id,
              membershipStartDate: preserveCurrentActiveWindow ? profile.membershipStartDate : membership.startDate,
              membershipExpirationDate: preserveCurrentActiveWindow ? profile.membershipExpirationDate : membership.expirationDate,
              membershipExpiresAt: preserveCurrentActiveWindow ? profile.membershipExpiresAt : membership.expiresAt,
              membershipPlan: membership.plan || profile.membershipPlan,
              membershipPlanId: request.planId,
              membershipPaymentMethod: membership.paymentMethod,
              membershipPaymentStatus: preserveAuthoritativePayment ? 'Paid' : membership.paymentStatus,
              membershipPaymentTransactionId: preserveAuthoritativePayment ? profile.membershipPaymentTransactionId : undefined,
              membershipPaymentAmountCents: preserveAuthoritativePayment ? profile.membershipPaymentAmountCents : undefined,
              membershipStatus: preserveCurrentActiveWindow ? 'Active' : membership.status,
              membershipRequestedAt: membership.requestedAt,
              membershipPriceLabel: request.priceLabel,
              membershipPlanName: request.planName,
              membershipDurationDays: request.membershipDurationDays,
              preferredGameId: profile.preferredGameId,
              preferredGameIds: mergeUnique([...(profile.preferredGameIds || []), ...(player.preferredGameIds || [])]),
              preferredStakes: player.preferredStakes || profile.preferredStakes,
              typicalAvailability: player.typicalAvailability || profile.typicalAvailability,
              email: player.email || profile.email,
              phone: player.phone || profile.phone,
              ...getIdentityProfileFields(request, profile),
              notes: appendSyncNote(profile.notes, 'Player app membership request received')
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
        id: player.id || getFallbackId(request.id, options),
        orbitPlayerId: player.id,
        name: request.identitySummary?.fullName || player.name || 'Player',
        email: player.email || '',
        phone: player.phone || '',
        birthday: request.identitySummary?.dateOfBirth || '',
        address: request.identitySummary?.address || '',
        membershipStartDate: membership.startDate,
        membershipExpirationDate: membership.expirationDate,
        membershipExpiresAt: membership.expiresAt,
        ...(membership.plan ? { membershipPlan: membership.plan } : {}),
        membershipPlanId: request.planId,
        membershipPaymentMethod: membership.paymentMethod,
        membershipPaymentStatus: membership.paymentStatus,
        membershipStatus: membership.status,
        membershipRequestedAt: membership.requestedAt,
        membershipPriceLabel: request.priceLabel,
        membershipPlanName: request.planName,
        membershipDurationDays: request.membershipDurationDays,
        totalTimePlayedHours: 0,
        lastSessionTimePlayedHours: 0,
        commonlyPlaysWithProfileIds: [],
        preferredGameId: '',
        preferredGameIds: player.preferredGameIds || [],
        preferredStakes: player.preferredStakes || '',
        typicalBuyInMin: 0,
        typicalBuyInMax: 0,
        willingnessToMove: false,
        typicalAvailability: player.typicalAvailability || '',
        preferredTags: [],
        usualCompanions: [],
        notes: 'Player app membership request received',
        ...getIdentityProfileFields(request)
      }
    ]
  };
}

function applyMembershipPaymentToState(state, payment, options = {}) {
  if (options.validateState !== false) validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (payment.clubId !== accountKey || !payment.transactionId || !payment.playerId) return state;
  if ((state.revenueTransactions || []).some((transaction) => transaction.id === payment.transactionId)) return state;
  const occurredAt = payment.occurredAt || new Date().toISOString();
  const plan = payment.product === 'day' ? 'day' : 'monthly';
  const durationDays = Number.isFinite(Number(payment.membershipDurationDays))
    ? Math.max(1, Number(payment.membershipDurationDays))
    : plan === 'day' ? 1 : 30;
  const startDate = occurredAt.slice(0, 10);
  const expirationDate = addDays(startDate, durationDays);
  const isTimePackage = payment.product === 'time' || /^time-(?:30|60|120|5)$/.test(String(payment.product || ''));
  const timeMinutes = isTimePackage
    ? Math.max(1, Math.floor(Number(payment.timeMinutes || (payment.product === 'time-5' ? 300 : 0))))
    : 0;
  const activeTimeSession = isTimePackage
    ? (state.playerSessions || []).find((session) => {
        if (session.leftAt || session.profileId !== payment.playerId) return false;
        const table = (state.sessions || []).find((candidate) => candidate.id === session.tableId);
        return table && (table.collectionMode === 'Time' || table.timeFeeBased);
      })
    : undefined;
  const elapsedMinutes = activeTimeSession?.timeFeeEnabled && activeTimeSession.lastTimeTickAt
    ? Math.max(0, (Date.parse(occurredAt) - Date.parse(activeTimeSession.lastTimeTickAt)) / 60_000)
    : 0;
  return {
    ...state,
    profiles: isTimePackage
      ? (state.profiles || []).map((profile) => profile.id === payment.playerId && !activeTimeSession
          ? { ...profile, savedTimeCreditMinutes: Math.max(0, Number(profile.savedTimeCreditMinutes) || 0) + timeMinutes }
          : profile)
      : (state.profiles || []).map((profile) => {
          if (profile.id !== payment.playerId) return profile;
          const identityApproved = profile.identityReviewStatus === 'Approved' || profile.identityReviewStatus === 'Not required';
          return {
            ...profile,
            membershipPaymentMethod: 'app',
            membershipPaymentStatus: 'Paid',
            membershipPaymentTransactionId: payment.transactionId,
            membershipPaymentAmountCents: Number(payment.amountCents || 0),
            membershipStatus: identityApproved ? 'Active' : 'Approved',
            membershipStartDate: identityApproved ? startDate : '',
            membershipExpirationDate: identityApproved ? expirationDate : '',
            membershipExpiresAt: identityApproved ? `${expirationDate}T23:59:59.999Z` : undefined
          };
        }),
    playerSessions: activeTimeSession
      ? (state.playerSessions || []).map((session) => session.id === activeTimeSession.id
          ? {
              ...session,
              timePurchasedMinutes: Math.max(0, Number(session.timePurchasedMinutes) || 0) + timeMinutes,
              timeRemainingMinutes: Math.max(0, (Number(session.timeRemainingMinutes) || 0) - elapsedMinutes) + timeMinutes,
              lastTimeTickAt: occurredAt,
              timeFeeEnabled: true
            }
          : session)
      : state.playerSessions,
    revenueTransactions: [
      ...(state.revenueTransactions || []),
      {
        id: payment.transactionId,
        type: isTimePackage ? 'time-package' : 'membership',
        amountCents: Number(payment.amountCents || 0),
        occurredAt,
        paymentStatus: 'paid',
        source: 'stripe',
        playerId: payment.playerId,
        playerName: payment.playerName || '',
        playerEmail: payment.playerEmail || '',
        membershipPlan: isTimePackage ? null : plan,
        stripeEventId: payment.stripeEventId || ''
      }
    ]
  };
}

/** @param {OrbitCoreOptions} [options] */
function applyWaitlistRequestToState(state, request, options = {}) {
  if (options.validateState !== false) validateStatePayload(state);
  const accountKey = getAccountKeyFromState(state);
  if (request.clubId !== accountKey) return state;
  const player = request.player || {};
  const profile = (state.profiles || []).find((candidate) => matchesAuthenticatedProfile(candidate, player));
  const immutablePlayerIds = new Set([player.id, profile?.id, profile?.orbitPlayerId]
    .map((value) => String(value || '').trim())
    .filter(Boolean));
  const matchesPlayer = (interest) => immutablePlayerIds.has(String(interest.profileId || ''));
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
  const authoritativeGame = (state.games || []).find((game) => String(game.id || '') === String(request.gameId || ''));
  if (!authoritativeGame) return state;
  const attendance = request.attendance || (!request.tableId ? 'interested' : undefined);
  const requestedTable = request.tableId
    ? (state.sessions || []).find((session) =>
        session.id === request.tableId &&
        session.gameId === request.gameId &&
        session.status === 'Running'
      )
    : undefined;
  const hasValidIntent = attendance === 'interested'
    ? !request.tableId
    : (attendance === 'arrived' || attendance === 'confirmed') && Boolean(requestedTable);
  if (!hasValidIntent) return state;
  const alreadyWaiting = (state.interests || []).some(
    (interest) =>
      interest.gameId === request.gameId &&
      activeWaitlistStatuses.has(interest.status) &&
      matchesPlayer(interest)
  );
  if (alreadyWaiting) return state;
  const status = attendance === 'arrived' ? 'Arrived' : attendance === 'confirmed' ? 'Confirmed Coming' : 'Interested';
  const requestedAt = request.requestedAt || new Date().toISOString();
  const syncedProfile = profile || {
    id: player.id,
    orbitPlayerId: player.id,
    name: request.identitySummary?.fullName || player.name || 'Player',
    email: player.email || '',
    phone: player.phone || '',
    birthday: request.identitySummary?.dateOfBirth || '',
    address: request.identitySummary?.address || '',
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
    notes: 'Player app game request received',
    ...getIdentityProfileFields(request)
  };
  const profiles = profile
    ? (state.profiles || []).map((candidate) => candidate.id === profile.id
      ? {
          ...candidate,
          email: player.email || candidate.email,
          phone: player.phone || candidate.phone,
          ...getIdentityProfileFields(request, candidate),
          preferredGameId: candidate.preferredGameId || request.gameId,
          preferredGameIds: Array.from(new Set([...(candidate.preferredGameIds || []), request.gameId])),
          notes: appendSyncNote(candidate.notes, 'Player app game request received')
        }
      : candidate)
    : [...(state.profiles || []), syncedProfile];
  return {
    ...state,
    profiles,
    interests: [
      ...(state.interests || []),
      {
        id: request.id || getFallbackId(request.id, options),
        profileId: syncedProfile.id,
        playerName: syncedProfile.name || 'Player',
        gameId: request.gameId,
        status,
        timestamp: requestedAt,
        interestedAt: requestedAt,
        confirmedAt: status === 'Confirmed Coming' ? requestedAt : undefined,
        arrivedAt: status === 'Arrived' ? requestedAt : undefined,
        expectedArrivalTime: request.expectedArrivalTime,
        availabilityStartTime: request.availabilityStartTime,
        availabilityEndTime: request.availabilityEndTime,
        ...(requestedTable ? { tableId: requestedTable.id } : {}),
        notes: [
          status === 'Arrived'
            ? `At club now; seat requested for ${requestedTable?.label || 'open table'}`
            : status === 'Confirmed Coming'
              ? `Confirmed coming${request.expectedArrivalTime ? ` at ${request.expectedArrivalTime}` : ''}`
              : `Interested${request.availabilityStartTime ? ` from ${request.availabilityStartTime}${request.availabilityEndTime ? ` to ${request.availabilityEndTime}` : ''}` : ''}`,
        ].filter(Boolean).join(' | ')
      }
    ]
  };
}

/**
 * @param {OrbitCoreOptions} [options]
 */
function createOrbitCore(options = {}) {
  return {
    applyMembershipPaymentToState: (state, payment) => applyMembershipPaymentToState(state, payment, options),
    applyMembershipRequestToState: (state, request) => applyMembershipRequestToState(state, request, options),
    applyWaitlistRequestToState: (state, request) => applyWaitlistRequestToState(state, request, options),
    buildPlayerClubSnapshot: (state, player) => buildPlayerClubSnapshot(state, player, options),
    getAccountKeyFromState,
    sanitizeAccountKey,
    validateStatePayload
  };
}

module.exports = {
  applyMembershipPaymentToState,
  applyMembershipRequestToState,
  applyWaitlistRequestToState,
  buildPlayerClubSnapshot,
  createOrbitCore,
  getAccountKeyFromState,
  sanitizeAccountKey,
  validateStatePayload
};
