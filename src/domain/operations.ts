import { defaultScriptTemplates, nowIso } from './state';
import type { AppState, GameConfig, GameSession, Interest, PlayerSession } from './types';

export const hoursBetween = (start: string, end = nowIso()) =>
  Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 36e5);

export const getTimeRemainingMinutes = (session: PlayerSession, nowMs = Date.now()) => {
  if (!session.timeFeeEnabled) return 0;
  const baseRemaining = session.timeRemainingMinutes ?? 0;
  const lastTick = new Date(session.lastTimeTickAt ?? session.seatedAt).getTime();
  return Math.max(0, baseRemaining - Math.floor((nowMs - lastTick) / 60000));
};

export function getDemand(game: GameConfig, interests: Interest[]) {
  const gameInterests = interests.filter((interest) => interest.gameId === game.id);
  const inRoom = gameInterests.filter((interest) => interest.status === 'Arrived' || interest.status === 'Seated').length;
  const confirmed = gameInterests.filter((interest) => interest.status === 'Confirmed Coming').length;
  const interested = gameInterests.filter((interest) => interest.status === 'Interested').length;
  const waiting = gameInterests.filter((interest) => interest.status === 'Arrived').length;
  const flexibleDemand = confirmed + interested + waiting;
  const totalDemand = inRoom + flexibleDemand;
  const likely = inRoom >= game.minInRoomForLikely && flexibleDemand >= game.minFlexibleForLikely;
  const needs = Math.max(0, game.minTotalForViable - totalDemand);

  return {
    inRoom,
    confirmed,
    interested,
    waiting,
    flexibleDemand,
    totalDemand,
    likely,
    needs,
    status: likely ? 'Likely to Start' : needs === 0 ? 'Viable' : `Needs ${needs} More`
  };
}

export function getRunningSessions(state: AppState, gameId: string) {
  return state.sessions.filter((session) => session.gameId === gameId && session.status === 'Running');
}

export function getOpenSessions(state: AppState, gameId: string) {
  return state.sessions.filter((session) => session.gameId === gameId && session.status !== 'Closed' && session.status !== 'Failed to Start');
}

export function getPlayerLoggedHours(state: AppState, playerSession: PlayerSession) {
  const samePlayerSessions = state.playerSessions.filter((session) =>
    playerSession.profileId
      ? session.profileId === playerSession.profileId
      : session.playerName.toLowerCase() === playerSession.playerName.toLowerCase()
  );
  const total = samePlayerSessions.reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt ?? nowIso()), 0);
  const tonight = state.playerSessions
    .filter((session) => session.id === playerSession.id || (
      !session.leftAt &&
      (playerSession.profileId
        ? session.profileId === playerSession.profileId
        : session.playerName.toLowerCase() === playerSession.playerName.toLowerCase())
    ))
    .reduce((sum, session) => sum + hoursBetween(session.seatedAt, session.leftAt ?? nowIso()), 0);
  return { tonight, total };
}

export function getSessionBuyIns(state: AppState, playerSession: PlayerSession) {
  return state.buyIns.filter((buyIn) =>
    buyIn.tableId === playerSession.tableId &&
    buyIn.gameId === playerSession.gameId &&
    (playerSession.profileId ? buyIn.profileId === playerSession.profileId : buyIn.playerName.toLowerCase() === playerSession.playerName.toLowerCase())
  );
}

export function getAverageStackForTable(state: AppState, tableId: string) {
  const activePlayers = state.playerSessions.filter((playerSession) => playerSession.tableId === tableId && !playerSession.leftAt);
  if (!activePlayers.length) return 0;
  const totalBuyIns = activePlayers.reduce(
    (sum, playerSession) => sum + getSessionBuyIns(state, playerSession).reduce((buyInSum, buyIn) => buyInSum + buyIn.amount, 0),
    0
  );
  return Math.round(totalBuyIns / activePlayers.length);
}

export function getSessionSeatHours(state: AppState, session: GameSession) {
  return state.playerSessions
    .filter((playerSession) => playerSession.tableId === session.id)
    .reduce((sum, playerSession) => sum + hoursBetween(playerSession.seatedAt, playerSession.leftAt), 0);
}

export function getViabilityState(state: AppState, game: GameConfig) {
  const demand = getDemand(game, state.interests);
  const running = getRunningSessions(state, game.id);
  const fullTable = running.some((session) => session.seatsFilled >= session.maxSeats);

  if (running.length && fullTable && demand.flexibleDemand >= game.minFlexibleForLikely) {
    return { state: 'Likely to Start', nextStep: 'Second table likely' };
  }

  if (!running.length && demand.inRoom >= game.minInRoomForLikely && demand.totalDemand >= game.minTotalForViable) {
    return { state: 'Ready to Start', nextStep: 'Enough in-room demand to start' };
  }

  if (running.length) {
    const totalSeats = running.reduce((sum, session) => sum + session.seatsFilled, 0);
    const totalCapacity = running.reduce((sum, session) => sum + session.maxSeats, 0);
    if (totalSeats <= Math.floor(totalCapacity * 0.55) && demand.flexibleDemand < 2) {
      return { state: 'Fragile', nextStep: 'Game may not sustain yet' };
    }
    return { state: 'Running', nextStep: demand.waiting ? `${demand.waiting} waiting` : 'Game is active' };
  }

  if (demand.likely) return { state: 'Likely to Start', nextStep: 'Coordinate arrivals' };
  if (demand.totalDemand >= Math.max(2, game.minTotalForViable - 2)) {
    return { state: 'Building', nextStep: `Needs ${demand.needs} more player${demand.needs === 1 ? '' : 's'}` };
  }
  return { state: 'Not Enough Interest', nextStep: `Needs ${demand.needs} more players` };
}

export function getTableHealth(state: AppState, session: GameSession) {
  const demand = getDemand(state.games.find((game) => game.id === session.gameId)!, state.interests);
  const fillRate = session.maxSeats ? session.seatsFilled / session.maxSeats : 0;
  if (session.status === 'Forming') return 'Building';
  if (fillRate >= 0.75 || demand.waiting > 0) return 'Healthy';
  if (fillRate >= 0.55 || demand.flexibleDemand >= 2) return 'Needs Attention';
  return 'Fragile';
}

export function getOverflowOpportunities(state: AppState) {
  return state.games
    .map((game) => {
      const demand = getDemand(game, state.interests);
      const fullTables = getRunningSessions(state, game.id).filter((session) => session.seatsFilled >= session.maxSeats);
      return {
        game,
        demand,
        fullTables,
        label: `${game.name} full - ${demand.flexibleDemand} waiting/interested - ${
          demand.flexibleDemand >= game.minFlexibleForLikely ? 'second table possible' : 'keep gathering interest'
        }`
      };
    })
    .filter((item) => item.fullTables.length && item.demand.flexibleDemand > 0);
}

export function getClosestGameLabel(state: AppState) {
  const closest = state.games
    .map((game) => ({ game, demand: getDemand(game, state.interests) }))
    .sort((a, b) => a.demand.needs - b.demand.needs || b.demand.totalDemand - a.demand.totalDemand)[0];

  if (!closest) return '-';
  return closest.demand.likely ? `${closest.game.name} likely` : `${closest.game.name}: needs ${closest.demand.needs}`;
}

export function renderScriptTemplate(template: string, game: GameConfig, demand: ReturnType<typeof getDemand>) {
  return template
    .replaceAll('{game}', game.name)
    .replaceAll('{inRoom}', demand.inRoom.toString())
    .replaceAll('{coming}', demand.confirmed.toString())
    .replaceAll('{waiting}', (demand.interested + demand.waiting).toString())
    .replaceAll('{needs}', demand.needs.toString());
}

export function getStaffScripts(state: AppState) {
  const gameScripts = state.games.flatMap((game) => {
    const demand = getDemand(game, state.interests);
    const running = getRunningSessions(state, game.id);
    const full = running.some((session) => session.seatsFilled >= session.maxSeats);
    const scripts = [{ label: `${game.name}: current demand`, text: renderScriptTemplate(state.scriptTemplates[0] ?? defaultScriptTemplates[0], game, demand) }];
    if (full && demand.flexibleDemand > 0) {
      scripts.push({
        label: `${game.name}: overflow`,
        text: renderScriptTemplate(state.scriptTemplates[1] ?? defaultScriptTemplates[1], game, demand)
      });
    }
    if (demand.needs > 0) {
      scripts.push({
        label: `${game.name}: needs more`,
        text: renderScriptTemplate(state.scriptTemplates[2] ?? defaultScriptTemplates[2], game, demand)
      });
    } else {
      scripts.push({
        label: `${game.name}: likely`,
        text: renderScriptTemplate(state.scriptTemplates[3] ?? defaultScriptTemplates[3], game, demand)
      });
    }
    return scripts;
  });
  return gameScripts.slice(0, 8);
}
