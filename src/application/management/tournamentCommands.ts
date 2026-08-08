import { defaultTournamentLevels, defaultTournamentPayouts } from '../../domain/state';
import type { AppState, Tournament, TournamentPlayer } from '../../domain/types';

export type TournamentDraft = {
  name: string;
  buyIn: string;
  startingStack: string;
  levelMinutes: string;
  rebuyPrizePercent: string;
  tableSize: string;
};

export type TournamentPlayerDraft = {
  name: string;
  profileId: string;
  phone: string;
  email: string;
};

export type TournamentCommandDependencies = {
  createId: () => string;
  nowIso: () => string;
};

const replaceTournament = (
  state: AppState,
  tournamentId: string,
  updater: (tournament: Tournament) => Tournament
): AppState => ({
  ...state,
  tournaments: state.tournaments.map((tournament) =>
    tournament.id === tournamentId ? updater(tournament) : tournament
  )
});

const normalizeTournamentDraft = (draft: TournamentDraft) => ({
  buyIn: Math.max(0, Number(draft.buyIn) || 0),
  startingStack: Math.max(1000, Number(draft.startingStack) || 20_000),
  levelMinutes: Math.max(5, Number(draft.levelMinutes) || 20),
  rebuyPrizePercent: Math.min(100, Math.max(0, Number(draft.rebuyPrizePercent) || 0)),
  tableSize: Math.min(10, Math.max(2, Number(draft.tableSize) || 9))
});

export function createTournament(
  state: AppState,
  draft: TournamentDraft,
  dependencies: TournamentCommandDependencies
) {
  const name = draft.name.trim();
  if (!name) return null;
  const normalized = normalizeTournamentDraft(draft);
  const tournament: Tournament = {
    id: dependencies.createId(),
    name,
    status: 'Draft',
    createdAt: dependencies.nowIso(),
    currentLevelIndex: 0,
    buyIn: normalized.buyIn,
    startingStack: normalized.startingStack,
    rebuyPrizePercent: normalized.rebuyPrizePercent,
    tableSize: normalized.tableSize,
    levels: defaultTournamentLevels().map((level) => ({ ...level, durationMinutes: normalized.levelMinutes })),
    players: [],
    payouts: defaultTournamentPayouts()
  };
  return { state: { ...state, tournaments: [tournament, ...state.tournaments] }, tournament };
}

export function updateTournamentSettings(
  state: AppState,
  tournamentId: string,
  draft: TournamentDraft
): AppState {
  const normalized = normalizeTournamentDraft(draft);
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    name: draft.name.trim() || tournament.name,
    buyIn: normalized.buyIn,
    startingStack: normalized.startingStack,
    rebuyPrizePercent: normalized.rebuyPrizePercent,
    tableSize: normalized.tableSize,
    levels: tournament.levels.map((level) => ({ ...level, durationMinutes: normalized.levelMinutes }))
  }));
}

export function rerunTournament(
  state: AppState,
  source: Tournament,
  dependencies: TournamentCommandDependencies
) {
  const tournament: Tournament = {
    ...source,
    id: dependencies.createId(),
    name: source.name,
    createdAt: dependencies.nowIso(),
    status: 'Draft',
    startedAt: undefined,
    pausedAt: undefined,
    completedAt: undefined,
    currentLevelIndex: 0,
    levelStartedAt: undefined,
    pausedRemainingSeconds: undefined,
    players: []
  };
  return { state: { ...state, tournaments: [tournament, ...state.tournaments] }, tournament };
}

export function drawTournamentTables(
  state: AppState,
  tournament: Tournament,
  random: () => number
): AppState {
  const shuffled = tournament.players
    .filter((player) => player.status !== 'Eliminated')
    .map((player) => ({ player, sort: random() }))
    .sort((left, right) => left.sort - right.sort)
    .map(({ player }) => player);
  const tableCount = Math.max(1, Math.ceil(shuffled.length / tournament.tableSize));
  const assignments = new Map(shuffled.map((player, index) => [
    player.id,
    { tableNumber: (index % tableCount) + 1, seatNumber: Math.floor(index / tableCount) + 1 }
  ]));
  return replaceTournament(state, tournament.id, (current) => ({
    ...current,
    players: current.players.map((player) =>
      assignments.has(player.id) ? { ...player, ...assignments.get(player.id) } : player
    )
  }));
}

export function registerTournamentPlayer(
  state: AppState,
  tournament: Tournament,
  draft: TournamentPlayerDraft,
  dependencies: TournamentCommandDependencies
) {
  const profile = state.profiles.find((candidate) => candidate.id === draft.profileId);
  const name = (profile?.name || draft.name).trim();
  if (!name) return null;
  const player: TournamentPlayer = {
    id: dependencies.createId(),
    profileId: profile?.id,
    name,
    phone: profile?.phone || draft.phone.trim(),
    email: draft.email.trim(),
    buyIn: tournament.buyIn,
    rebuys: 0,
    addOns: 0,
    startingStack: tournament.startingStack,
    status: tournament.status === 'Draft' ? 'Registered' : 'Active',
    registeredAt: dependencies.nowIso()
  };
  return {
    player,
    state: replaceTournament(state, tournament.id, (current) => ({
      ...current,
      players: [...current.players, player]
    }))
  };
}

export function startTournament(
  state: AppState,
  tournamentId: string,
  dependencies: Pick<TournamentCommandDependencies, 'nowIso'>
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    status: 'Running',
    startedAt: tournament.startedAt ?? dependencies.nowIso(),
    levelStartedAt: dependencies.nowIso(),
    pausedRemainingSeconds: undefined,
    players: tournament.players.map((player) => ({
      ...player,
      status: player.status === 'Registered' || player.status === 'Checked In' ? 'Active' : player.status
    }))
  }));
}

export function pauseTournament(
  state: AppState,
  tournamentId: string,
  nowMs: number,
  dependencies: Pick<TournamentCommandDependencies, 'nowIso'>
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    status: 'Paused',
    pausedAt: dependencies.nowIso(),
    pausedRemainingSeconds: (() => {
      const level = tournament.levels[tournament.currentLevelIndex];
      if (!level) return 0;
      if (tournament.status === 'Paused') return tournament.pausedRemainingSeconds ?? level.durationMinutes * 60;
      if (tournament.status !== 'Running' || !tournament.levelStartedAt) return level.durationMinutes * 60;
      return Math.max(
        0,
        level.durationMinutes * 60 - Math.floor((nowMs - new Date(tournament.levelStartedAt).getTime()) / 1000)
      );
    })()
  }));
}

export function resumeTournament(
  state: AppState,
  tournamentId: string,
  levelDurationMinutes: number,
  remainingSeconds: number,
  nowMs: number
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    status: 'Running',
    levelStartedAt: new Date(nowMs - ((levelDurationMinutes * 60 - remainingSeconds) * 1000)).toISOString()
  }));
}

export function advanceTournamentLevel(
  state: AppState,
  tournamentId: string,
  direction: 1 | -1,
  dependencies: Pick<TournamentCommandDependencies, 'nowIso'>
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    currentLevelIndex: Math.min(
      Math.max(tournament.currentLevelIndex + direction, 0),
      Math.max(tournament.levels.length - 1, 0)
    ),
    levelStartedAt: tournament.status === 'Running' ? dependencies.nowIso() : tournament.levelStartedAt,
    pausedRemainingSeconds: undefined
  }));
}

export function eliminateTournamentPlayer(
  state: AppState,
  source: Tournament,
  playerId: string,
  dependencies: Pick<TournamentCommandDependencies, 'nowIso'>
): AppState {
  const remainingAfter = source.players.filter((player) => player.status !== 'Eliminated').length - 1;
  return replaceTournament(state, source.id, (tournament) => ({
    ...tournament,
    players: tournament.players.map((player) => player.id === playerId
      ? {
          ...player,
          status: 'Eliminated',
          eliminatedAt: dependencies.nowIso(),
          finishPlace: Math.max(1, remainingAfter + 1)
        }
      : player),
    status: remainingAfter <= 1 && tournament.status !== 'Draft' ? 'Finished' : tournament.status,
    completedAt: remainingAfter <= 1 && tournament.status !== 'Draft'
      ? dependencies.nowIso()
      : tournament.completedAt
  }));
}

export function addTournamentEntry(
  state: AppState,
  tournamentId: string,
  playerId: string,
  field: 'rebuys' | 'addOns'
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    players: tournament.players.map((player) =>
      player.id === playerId ? { ...player, [field]: player[field] + 1 } : player
    )
  }));
}

export function updateTournamentPayout(
  state: AppState,
  tournamentId: string,
  place: number,
  percent: number
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    payouts: [
      ...tournament.payouts.filter((payout) => payout.place !== place),
      { place, percent: Math.max(0, percent) }
    ].sort((left, right) => left.place - right.place)
  }));
}

export function checkInTournamentPlayer(
  state: AppState,
  tournamentId: string,
  playerId: string
): AppState {
  return replaceTournament(state, tournamentId, (tournament) => ({
    ...tournament,
    players: tournament.players.map((player) =>
      player.id === playerId ? { ...player, status: 'Checked In' } : player
    )
  }));
}
