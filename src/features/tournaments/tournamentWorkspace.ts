import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction
} from 'react';
import { nowIso, todayDate, uid } from '../../domain/state';
import type { AppState, Tournament } from '../../domain/types';
import {
  addTournamentEntry as addTournamentEntryInState,
  advanceTournamentLevel as advanceTournamentLevelInState,
  checkInTournamentPlayer as checkInTournamentPlayerInState,
  createTournament as createTournamentInState,
  drawTournamentTables as drawTournamentTablesInState,
  eliminateTournamentPlayer as eliminateTournamentPlayerInState,
  pauseTournament as pauseTournamentInState,
  registerTournamentPlayer as registerTournamentPlayerInState,
  rerunTournament,
  resumeTournament as resumeTournamentInState,
  startTournament as startTournamentInState,
  updateTournamentPayout as updateTournamentPayoutInState,
  updateTournamentSettings
} from '../../application/management/tournamentCommands';

export type TournamentView = 'library' | 'create' | 'edit' | 'manage';
export type TournamentSection = 'clock' | 'players' | 'tables' | 'payouts';

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

export const formatTournamentTime = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const getTournamentLevel = (tournament?: Tournament | null) =>
  tournament?.levels[tournament.currentLevelIndex] ?? null;

export const getNextTournamentLevel = (tournament?: Tournament | null) =>
  tournament?.levels[(tournament.currentLevelIndex ?? 0) + 1] ?? null;

export const getTournamentLevelRemainingSeconds = (
  tournament: Tournament | null | undefined,
  nowMs = Date.now()
) => {
  const level = getTournamentLevel(tournament);
  if (!tournament || !level) return 0;
  if (tournament.status === 'Paused') return tournament.pausedRemainingSeconds ?? level.durationMinutes * 60;
  if (tournament.status !== 'Running' || !tournament.levelStartedAt) return level.durationMinutes * 60;
  return Math.max(0, level.durationMinutes * 60 - Math.floor((nowMs - new Date(tournament.levelStartedAt).getTime()) / 1000));
};

export const getTournamentEntries = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).reduce((sum, player) => sum + 1 + player.rebuys + player.addOns, 0);

export const getTournamentActivePlayers = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).filter((player) => player.status !== 'Eliminated').length;

export const getTournamentPrizePool = (tournament?: Tournament | null) =>
  (tournament?.players ?? []).reduce(
    (sum, player) => sum + player.buyIn +
      player.rebuys * (tournament?.rebuyPrice ?? player.buyIn) * ((tournament?.rebuyPrizePercent ?? 100) / 100) +
      player.addOns * (tournament?.addOnPrice ?? player.buyIn) * ((tournament?.rebuyPrizePercent ?? 100) / 100),
    0
  );

export const getTournamentAverageStack = (tournament?: Tournament | null) => {
  const activePlayers = getTournamentActivePlayers(tournament);
  if (!tournament || !activePlayers) return 0;
  const totalChips = (tournament.players ?? []).reduce(
    (sum, player) => sum + (1 + player.rebuys + player.addOns) * player.startingStack,
    0
  );
  return Math.round(totalChips / activePlayers);
};

export const useTournamentWorkspaceState = () => {
  const [selectedTournamentId, setSelectedTournamentId] = useState('');
  const [tournamentView, setTournamentView] = useState<TournamentView>('library');
  const [tournamentSection, setTournamentSection] = useState<TournamentSection>('clock');
  const [tournamentDraft, setTournamentDraft] = useState<TournamentDraft>({
    name: `Tournament ${todayDate()}`,
    buyIn: '100',
    startingStack: '20000',
    levelMinutes: '20',
    rebuyPrizePercent: '100',
    tableSize: '9'
  });
  const [tournamentPlayerDraft, setTournamentPlayerDraft] = useState<TournamentPlayerDraft>({
    name: '',
    profileId: '',
    phone: '',
    email: ''
  });
  const [tournamentPayoutDrafts, setTournamentPayoutDrafts] = useState<Record<number, string>>({});

  return {
    selectedTournamentId,
    setSelectedTournamentId,
    setTournamentDraft,
    setTournamentPayoutDrafts,
    setTournamentPlayerDraft,
    setTournamentSection,
    setTournamentView,
    tournamentDraft,
    tournamentPayoutDrafts,
    tournamentPlayerDraft,
    tournamentSection,
    tournamentView
  };
};

export const useSelectedTournament = (tournaments: Tournament[], selectedTournamentId: string) =>
  useMemo(
    () => tournaments.find((tournament) => tournament.id === selectedTournamentId) ?? tournaments[0] ?? null,
    [selectedTournamentId, tournaments]
  );

export const useTournamentSelectionRepair = (
  tournaments: Tournament[],
  selectedTournamentId: string,
  setSelectedTournamentId: Dispatch<SetStateAction<string>>
) => {
  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]) {
      setSelectedTournamentId(tournaments[0].id);
    }
    if (selectedTournamentId && !tournaments.some((tournament) => tournament.id === selectedTournamentId)) {
      setSelectedTournamentId(tournaments[0]?.id ?? '');
    }
  }, [selectedTournamentId, tournaments]);
};

type TournamentActionsOptions = ReturnType<typeof useTournamentWorkspaceState> & {
  clockNow: number;
  onPersist: (state: AppState, usageAction: string) => void;
  openTournamentTv: (tournamentId: string) => void;
  selectedTournament: Tournament | null;
  state: AppState;
};

export const createTournamentActions = ({
  clockNow,
  onPersist,
  openTournamentTv,
  selectedTournament,
  setSelectedTournamentId,
  setTournamentDraft,
  setTournamentPlayerDraft,
  setTournamentSection,
  setTournamentView,
  state,
  tournamentDraft,
  tournamentPlayerDraft
}: TournamentActionsOptions) => {
  const createTournament = (event: FormEvent) => {
    event.preventDefault();
    const result = createTournamentInState(state, tournamentDraft, { createId: uid, nowIso });
    if (!result) return;
    onPersist(result.state, 'Created tournament');
    setSelectedTournamentId(result.tournament.id);
    setTournamentView('manage');
    setTournamentSection('clock');
  };

  const beginTournamentEdit = (tournament: Tournament) => {
    setSelectedTournamentId(tournament.id);
    setTournamentDraft({
      name: tournament.name,
      buyIn: String(tournament.buyIn),
      startingStack: String(tournament.startingStack),
      levelMinutes: String(tournament.levels[0]?.durationMinutes ?? 20),
      rebuyPrizePercent: String(tournament.rebuyPrizePercent ?? 100),
      tableSize: String(tournament.tableSize ?? 9)
    });
    setTournamentView('edit');
  };

  const saveTournamentSettings = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTournament) return;
    onPersist(
      updateTournamentSettings(state, selectedTournament.id, tournamentDraft),
      'Updated tournament settings'
    );
    setTournamentView('library');
  };

  const runTournamentAgain = (source: Tournament) => {
    const result = rerunTournament(state, source, { createId: uid, nowIso });
    onPersist(result.state, 'Created recurring tournament');
    setSelectedTournamentId(result.tournament.id);
    setTournamentView('manage');
    setTournamentSection('players');
  };

  const drawTournamentTables = (tournament: Tournament) => {
    onPersist(drawTournamentTablesInState(state, tournament, Math.random), 'Drew tournament tables');
  };

  const registerTournamentPlayer = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedTournament) return;
    const result = registerTournamentPlayerInState(
      state,
      selectedTournament,
      tournamentPlayerDraft,
      { createId: uid, nowIso }
    );
    if (!result) return;
    onPersist(result.state, 'Registered player');
    setTournamentPlayerDraft({ name: '', profileId: '', phone: '', email: '' });
  };

  const startTournament = (tournament: Tournament) => {
    onPersist(startTournamentInState(state, tournament.id, { nowIso }), 'Started tournament');
    window.setTimeout(() => openTournamentTv(tournament.id), 100);
  };

  const pauseTournament = (tournament: Tournament) => {
    onPersist(pauseTournamentInState(state, tournament.id, clockNow, { nowIso }), 'Paused tournament');
  };

  const resumeTournament = (tournament: Tournament) => {
    const level = getTournamentLevel(tournament);
    const remaining = tournament.pausedRemainingSeconds ?? (level?.durationMinutes ?? 20) * 60;
    onPersist(
      resumeTournamentInState(state, tournament.id, level?.durationMinutes ?? 20, remaining, Date.now()),
      'Resumed tournament'
    );
  };

  const advanceTournamentLevel = (tournament: Tournament, direction: 1 | -1) => {
    onPersist(
      advanceTournamentLevelInState(state, tournament.id, direction, { nowIso }),
      direction > 0 ? 'Advanced level' : 'Rewound level'
    );
  };

  const eliminateTournamentPlayer = (tournament: Tournament, playerId: string) => {
    onPersist(eliminateTournamentPlayerInState(state, tournament, playerId, { nowIso }), 'Eliminated player');
  };

  const addTournamentEntry = (tournament: Tournament, playerId: string, field: 'rebuys' | 'addOns') => {
    onPersist(
      addTournamentEntryInState(state, tournament.id, playerId, field),
      field === 'rebuys' ? 'Added rebuy' : 'Added add-on'
    );
  };

  const updateTournamentPayout = (tournament: Tournament, place: number, percent: number) => {
    onPersist(updateTournamentPayoutInState(state, tournament.id, place, percent), 'Updated payout');
  };

  const checkInTournamentPlayer = (tournament: Tournament, playerId: string) => {
    onPersist(checkInTournamentPlayerInState(state, tournament.id, playerId), 'Checked in player');
  };

  return {
    addTournamentEntry,
    advanceTournamentLevel,
    beginTournamentEdit,
    checkInTournamentPlayer,
    createTournament,
    drawTournamentTables,
    eliminateTournamentPlayer,
    pauseTournament,
    registerTournamentPlayer,
    resumeTournament,
    runTournamentAgain,
    saveTournamentSettings,
    startTournament,
    updateTournamentPayout
  };
};
