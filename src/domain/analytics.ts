import { getAccountKeyFromState } from './licensing';
import {
  getDemand,
  getSessionSeatHours,
  getTimeRemainingMinutes,
  hoursBetween
} from './operations';
import { getCollectionProfile } from './reporting';
import { nowIso } from './state';
import type { AppState, FeedbackEntry, NightRecord, UsageEvent } from './types';

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function getAnalytics(state: AppState) {
  const activeSessions = state.sessions.filter((session) => session.status === 'Running' || session.status === 'Forming');
  const completedSessions = state.sessions.filter((session) => session.endedAt);
  const liveSeatHours = activeSessions.reduce(
    (sum, session) => sum + session.seatsFilled * hoursBetween(session.startedAt),
    0
  );
  const completedSeatHours = completedSessions.reduce(
    (sum, session) => sum + session.seatsFilled * hoursBetween(session.startedAt, session.endedAt),
    0
  );
  const playerSeatHours = state.playerSessions.reduce(
    (sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt),
    0
  );
  const completedWaits = state.interests.filter((interest) => interest.arrivedAt && interest.seatedAt);
  const waitMinutes = completedWaits.map(
    (interest) => (new Date(interest.seatedAt!).getTime() - new Date(interest.arrivedAt!).getTime()) / 60000
  );
  const arrivalWaits = state.interests.filter((interest) => interest.interestedAt && interest.arrivedAt);
  const confirmedComing = state.interests.filter((interest) => interest.confirmedAt || interest.status === 'Confirmed Coming');
  const confirmedArrived = confirmedComing.filter((interest) => interest.arrivedAt || interest.status === 'Arrived' || interest.status === 'Seated');
  const durations = state.sessions.map((session) => hoursBetween(session.startedAt, session.endedAt));
  const conversionEligible = state.interests.filter((interest) => interest.status !== 'Removed');
  const convertedWaiters = state.interests.filter((interest) => interest.seatedAt).length;
  const noShows = state.interests.filter((interest) => interest.status === 'No-Show').length;
  const declined = state.interests.filter((interest) => interest.status === 'Declined').length;
  const leftBeforeSeated = state.interests.filter((interest) => interest.status === 'Left Before Seated').length;
  const totalArrivals = state.interests.filter((interest) => interest.arrivedAt || interest.status === 'Arrived' || interest.status === 'Seated').length;
  const seatHoursByGame = state.games.map((game) => ({
    game: game.name,
    hours: state.playerSessions
      .filter((session) => session.gameId === game.id)
      .reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt), 0)
  }));
  const seatHoursByTable = state.sessions.map((session) => ({
    table: session.label,
    game: state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown',
    hours: state.playerSessions
      .filter((playerSession) => playerSession.tableId === session.id)
      .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0)
  }));
  const estimatedTimeFeeRevenue = state.playerSessions.reduce((sum, playerSession) => {
    const session = state.sessions.find((item) => item.id === playerSession.tableId);
    if (!session || session.collectionMode !== 'Time') return sum;
    const profile = getCollectionProfile(state, playerSession.gameId);
    return sum + ((playerSession.timePurchasedMinutes ?? 0) / 60) * profile.hourlyFee;
  }, 0);
  const expiredTimeFeeSeats = state.playerSessions.filter((playerSession) => {
    const session = state.sessions.find((item) => item.id === playerSession.tableId);
    return session?.collectionMode === 'Time' && !playerSession.leftAt && (playerSession.timePurchasedMinutes ?? 0) > 0 && getTimeRemainingMinutes(playerSession) <= 0;
  }).length;
  const recordedDropTotal = state.dropLogs.reduce((sum, drop) => sum + drop.amount, 0);
  const estimatedDropRevenue = state.sessions.reduce((sum, session) => {
    if (session.collectionMode !== 'Drop') return sum;
    return sum + getSessionSeatHours(state, session) * getCollectionProfile(state, session.gameId).estimatedDropPerSeatHour;
  }, 0);
  const collectionValueByGame = state.games.map((game) => {
    const timeRevenue = state.playerSessions
      .filter((playerSession) => playerSession.gameId === game.id)
      .reduce((sum, playerSession) => {
        const session = state.sessions.find((item) => item.id === playerSession.tableId);
        return session?.collectionMode === 'Time'
          ? sum + ((playerSession.timePurchasedMinutes ?? 0) / 60) * getCollectionProfile(state, game.id).hourlyFee
          : sum;
      }, 0);
    const recordedDrop = state.dropLogs
      .filter((drop) => drop.gameId === game.id)
      .reduce((sum, drop) => sum + drop.amount, 0);
    const estimatedDrop = state.sessions
      .filter((session) => session.gameId === game.id && session.collectionMode === 'Drop')
      .reduce((sum, session) => sum + getSessionSeatHours(state, session) * getCollectionProfile(state, game.id).estimatedDropPerSeatHour, 0);
    return { game: game.name, timeRevenue, recordedDrop, estimatedDrop };
  });
  const waitByGame = state.games.map((game) => {
    const waits = completedWaits
      .filter((interest) => interest.gameId === game.id)
      .map((interest) => (new Date(interest.seatedAt!).getTime() - new Date(interest.arrivedAt!).getTime()) / 60000);
    return {
      game: game.name,
      averageMinutes: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0,
      count: waits.length
    };
  });
  const failedStartEvents = state.tableEvents.filter((event) => event.type === 'Failed to Start');
  const lostSeatHourEstimate = failedStartEvents.length * 2 + leftBeforeSeated * 1.5;
  const currentNight: NightRecord = {
    id: 'current',
    date: new Date().toISOString().slice(0, 10),
    occupiedSeatHours: Math.max(liveSeatHours + completedSeatHours, playerSeatHours),
    gamesStarted: state.sessions.filter((session) => session.status !== 'Closed').length,
    averageSessionDurationHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    averageActiveTables: activeSessions.length,
    waitlistConversionRate: conversionEligible.length ? convertedWaiters / conversionEligible.length : 0,
    hadTwoPlusTables: activeSessions.length >= 2
  };
  return {
    currentNight,
    activeTables: activeSessions.length,
    averageSeatsOccupied: activeSessions.length
      ? activeSessions.reduce((sum, session) => sum + session.seatsFilled, 0) / activeSessions.length
      : 0,
    averageSeatHoursPerPlayer: state.playerSessions.length ? playerSeatHours / state.playerSessions.length : 0,
    averageWaitMinutes: waitMinutes.length ? waitMinutes.reduce((sum, value) => sum + value, 0) / waitMinutes.length : 0,
    medianWaitMinutes: median(waitMinutes),
    averageInterestToArrivalMinutes: arrivalWaits.length
      ? arrivalWaits.reduce((sum, interest) => sum + (new Date(interest.arrivedAt!).getTime() - new Date(interest.interestedAt).getTime()) / 60000, 0) /
        arrivalWaits.length
      : 0,
    conversionRate: conversionEligible.length ? convertedWaiters / conversionEligible.length : 0,
    noShowRate: conversionEligible.length ? noShows / conversionEligible.length : 0,
    declineRate: conversionEligible.length ? declined / conversionEligible.length : 0,
    leftBeforeSeatedRate: conversionEligible.length ? leftBeforeSeated / conversionEligible.length : 0,
    noShows,
    declined,
    leftBeforeSeated,
    confirmedArrivalRate: confirmedComing.length ? confirmedArrived.length / confirmedComing.length : 0,
    waitlistAbandonmentCount: leftBeforeSeated + declined,
    lostSeatHourEstimate,
    failedStarts: state.tableEvents.filter((event) => event.type === 'Failed to Start').length,
    tableBreaks: state.tableEvents.filter((event) => event.type === 'Broke' || event.type === 'Closed').length,
    secondTablesStarted: state.sessions.filter((session) => session.status !== 'Failed to Start' && session.label !== 'Main Table').length,
    totalArrivals,
    peakWaitlistPressure: Math.max(...state.games.map((game) => getDemand(game, state.interests).waiting + getDemand(game, state.interests).interested), 0),
    seatHoursByGame,
    seatHoursByTable,
    estimatedTimeFeeRevenue,
    expiredTimeFeeSeats,
    recordedDropTotal,
    estimatedDropRevenue,
    collectionValueByGame,
    waitByGame,
    peakActiveTables: Math.max(activeSessions.length, state.history.reduce((max, night) => Math.max(max, night.averageActiveTables), 0)),
    peakInterestedByGame: state.games
      .map((game) => ({ game: game.name, count: getDemand(game, state.interests).totalDemand }))
      .sort((a, b) => b.count - a.count)[0]
  };
}

export function getUsageAnalytics(state: AppState) {
  const events = state.usageEvents ?? [];
  const eventsByFeature = [...events.reduce((map, event) => {
    const current = map.get(event.feature) ?? { feature: event.feature, count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(event.feature, current);
    return map;
  }, new Map<string, { feature: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const eventsByAction = [...events.reduce((map, event) => {
    const key = `${event.feature}:${event.action}`;
    const current = map.get(key) ?? { key, feature: event.feature, action: event.action, count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; feature: string; action: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const eventsByStaff = [...events.reduce((map, event) => {
    const key = event.staffId || 'unassigned';
    const current = map.get(key) ?? { key, staffName: event.staffName || 'Unassigned', staffRole: event.staffRole || '', count: 0, lastUsedAt: '' };
    current.count += 1;
    current.lastUsedAt = current.lastUsedAt && current.lastUsedAt > event.timestamp ? current.lastUsedAt : event.timestamp;
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; staffName: string; staffRole: string; count: number; lastUsedAt: string }>()).values()].sort((a, b) => b.count - a.count);
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return {
    totalEvents: events.length,
    eventsLast24Hours: events.filter((event) => new Date(event.timestamp).getTime() >= oneDayAgo).length,
    eventsLast7Days: events.filter((event) => new Date(event.timestamp).getTime() >= sevenDaysAgo).length,
    eventsByFeature,
    eventsByAction,
    eventsByStaff,
    recentEvents: [...events].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, 20)
  };
}

export type AnalyticalReportPayload = {
  app: 'TableManager';
  kind: 'analytical-report';
  version: 1;
  generatedAt: string;
  account: {
    accountKey: string;
    clubName: string;
    accountName: string;
    contactName: string;
    email: string;
    license: string;
  };
  operational: Record<string, string | number | boolean>;
  collectionByGame: ReturnType<typeof getAnalytics>['collectionValueByGame'];
  usage: {
    totalEvents: number;
    eventsLast24Hours: number;
    eventsLast7Days: number;
    features: ReturnType<typeof getUsageAnalytics>['eventsByFeature'];
    actions: ReturnType<typeof getUsageAnalytics>['eventsByAction'];
    staff: ReturnType<typeof getUsageAnalytics>['eventsByStaff'];
    recentEvents: UsageEvent[];
  };
  feedback: FeedbackEntry[];
};

export function buildAnalyticalReportPayload(
  state: AppState,
  analytics: ReturnType<typeof getAnalytics>,
  usageAnalytics: ReturnType<typeof getUsageAnalytics>
): AnalyticalReportPayload {
  const account = state.settings.clubAccount;
  const access = state.settings.pilotAccess;
  return {
    app: 'TableManager',
    kind: 'analytical-report',
    version: 1,
    generatedAt: nowIso(),
    account: {
      accountKey: getAccountKeyFromState(state),
      clubName: account?.clubName ?? '',
      accountName: account?.accountName ?? '',
      contactName: account?.contactName ?? '',
      email: account?.email ?? '',
      license: access?.licenseId || access?.authorizationCode || ''
    },
    operational: {
      occupiedSeatHours: Number(analytics.currentNight.occupiedSeatHours.toFixed(1)),
      averageWaitMinutes: Number(analytics.averageWaitMinutes.toFixed(0)),
      waitlistConversionRate: Number((analytics.conversionRate * 100).toFixed(0)),
      gamesStarted: analytics.currentNight.gamesStarted,
      tableBreaks: analytics.tableBreaks,
      failedStarts: analytics.failedStarts,
      medianWaitMinutes: Number(analytics.medianWaitMinutes.toFixed(0)),
      noShows: analytics.noShows,
      declined: analytics.declined,
      leftBeforeSeated: analytics.leftBeforeSeated,
      confirmedArrivalRate: Number((analytics.confirmedArrivalRate * 100).toFixed(0)),
      lostSeatHourEstimate: Number(analytics.lostSeatHourEstimate.toFixed(1)),
      secondTablesStarted: analytics.secondTablesStarted,
      totalArrivals: analytics.totalArrivals,
      activeTables: analytics.activeTables,
      estimatedTimeFeeRevenue: Number(analytics.estimatedTimeFeeRevenue.toFixed(2)),
      expiredTimeFeeSeats: analytics.expiredTimeFeeSeats,
      recordedDropTotal: Number(analytics.recordedDropTotal.toFixed(2)),
      estimatedDropRevenue: Number(analytics.estimatedDropRevenue.toFixed(2))
    },
    collectionByGame: analytics.collectionValueByGame,
    usage: {
      totalEvents: usageAnalytics.totalEvents,
      eventsLast24Hours: usageAnalytics.eventsLast24Hours,
      eventsLast7Days: usageAnalytics.eventsLast7Days,
      features: usageAnalytics.eventsByFeature,
      actions: usageAnalytics.eventsByAction,
      staff: usageAnalytics.eventsByStaff,
      recentEvents: usageAnalytics.recentEvents
    },
    feedback: state.feedback
  };
}

export function getOperationalOpportunities(state: AppState, analytics: ReturnType<typeof getAnalytics>) {
  const opportunities: string[] = [];
  if (analytics.failedStarts >= 2) {
    opportunities.push('Repeated failed starts: review arrival confirmation process.');
  }
  if (analytics.averageWaitMinutes >= 30 && analytics.conversionRate < 0.5) {
    opportunities.push('High wait with low conversion: reduce uncertainty for incoming players.');
  }
  if ((analytics.peakInterestedByGame?.count ?? 0) >= 8 && analytics.currentNight.gamesStarted <= 1) {
    opportunities.push('Strong demand with few starts: focus on second-table coordination.');
  }
  if (analytics.tableBreaks >= 2) {
    opportunities.push('Table breaks above normal: review late-night sustainability.');
  }
  if (!opportunities.length) {
    opportunities.push('No major operational flags yet. Keep tracking wait pressure and table starts.');
  }
  return opportunities;
}
