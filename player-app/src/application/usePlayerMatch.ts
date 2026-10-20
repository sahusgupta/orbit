import { useEffect, useMemo, useRef, useState } from 'react';
import { applyMatchOperation, createMatchState, decodeMatchState } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import { buildMatchCandidates, rankMatchCandidates, resolveSavedMatchGames } from '../domain/orbitMatchCandidates';
import { defaultMatchPreferences, type MatchCandidate, type MatchPreferences } from '../domain/orbitMatchTypes';
import type { PlayerAccount, PlayerClubSnapshot, PlayerCoordinate, PlayerTournament } from '../domain/playerSync';
import { playerMatchPersistence } from '../data/firebase/playerMatchRepository';
import { playerStorage } from '../data/storage/playerStorage';
import { createSecureUuid } from '../security/secureIdentifier';
import { createPlayerMatchController, type MatchControllerSnapshot, type MatchPersistencePort } from './playerMatchController';

function legacyPreferences(player: PlayerAccount): MatchPreferences {
  return { ...defaultMatchPreferences, favoriteClubIds: [...(player.favoriteClubIds ?? [])],
    variants: [...new Set(player.preferredGameIds.flatMap((id) => id.startsWith('nlh-') ? ['nlh' as const] : id.startsWith('plo-') ? ['plo' as const] : []))] };
}

function localPersistence(preferences: MatchPreferences): MatchPersistencePort {
  let current = createMatchState(preferences);
  return {
    async loadJournal(uid) {
      const journal = await playerStorage.loadMatchJournal(uid);
      if (journal && typeof journal === 'object') {
        const restored = decodeMatchState(Reflect.get(journal, 'confirmed'));
        if (restored) current = restored;
      }
      return journal;
    },
    saveJournal: (uid, journal) => playerStorage.saveMatchJournal(uid, journal),
    async fetchState() { return current; },
    async mutate(_uid, operation) { current = applyMatchOperation(current, operation); return current; },
    subscribe() { return () => undefined; }
  };
}

export function usePlayerMatch({ player, authenticatedUid, demoMode, enabled, clubs, tournaments, activeGameKeys,
  origin, nowMs, inventoryStatus, inventoryPartial, tournamentDataStatus = inventoryStatus, tournamentDataPartial = inventoryPartial,
  candidateFilter, timeZone: selectedTimeZone }: {
  player: PlayerAccount; authenticatedUid: string | null; demoMode: boolean; enabled: boolean;
  clubs: PlayerClubSnapshot[]; tournaments: PlayerTournament[]; activeGameKeys: Set<string>;
  origin: PlayerCoordinate | null; nowMs: number;
  inventoryStatus: 'idle' | 'loading' | 'ready' | 'error'; inventoryPartial: boolean;
  tournamentDataStatus?: 'idle' | 'loading' | 'ready' | 'error'; tournamentDataPartial?: boolean;
  candidateFilter?: (candidate: MatchCandidate, preferences: MatchPreferences) => boolean;
  timeZone?: string;
}) {
  const scope = demoMode ? 'demo' : authenticatedUid === player.id ? 'account' : 'device';
  const owner = `${scope}:${player.id}`;
  const preferences = useMemo(() => legacyPreferences(player), [owner]);
  const controllerRef = useRef<ReturnType<typeof createPlayerMatchController> | null>(null);
  const [storedSnapshot, setStoredSnapshot] = useState<{ owner: string; snapshot: MatchControllerSnapshot } | null>(null);
  const snapshot = storedSnapshot?.owner === owner ? storedSnapshot.snapshot : {
    state: createMatchState(preferences), ready: false, working: false, pending: false, error: ''
  };
  useEffect(() => {
    if (!enabled || !player.id) { controllerRef.current = null; return; }
    const port = scope === 'account' ? playerMatchPersistence : scope === 'device' ? localPersistence(preferences) : null;
    const controller = createPlayerMatchController({ uid: scope === 'device' ? owner : player.id, preferences, port,
      createId: createSecureUuid, onChange: (next) => setStoredSnapshot({ owner, snapshot: next }) });
    controllerRef.current = controller;
    void controller.start();
    return () => { controller.dispose(); if (controllerRef.current === controller) controllerRef.current = null; };
  }, [enabled, owner]);
  const tournamentsReady = inventoryStatus === 'ready' && tournamentDataStatus === 'ready';
  const catalog = useMemo(() => buildMatchCandidates({ clubs, player, activeGameKeys, origin, nowMs,
    tournaments: tournamentsReady ? tournaments : [] }),
    [clubs, player, activeGameKeys, origin, nowMs, tournaments, tournamentsReady]);
  let timeZone = selectedTimeZone ?? 'UTC';
  try { timeZone = Intl.DateTimeFormat('en-US', selectedTimeZone ? { timeZone: selectedTimeZone } : undefined).resolvedOptions().timeZone || 'UTC'; }
  catch { timeZone = 'UTC'; }
  // Controller acknowledgement/history snapshots clone records. Only ranking-relevant semantics invalidate sorting.
  const preferenceKey = JSON.stringify(snapshot.state.preferences);
  const decisionKey = JSON.stringify(snapshot.state.decisions.map((record) => [record.ref.clubId, record.ref.kind, record.ref.gameId, record.decision]));
  const ranked = useMemo(() => inventoryStatus === 'ready' ? rankMatchCandidates({ candidates: candidateFilter ? catalog.filter((candidate) => candidateFilter(candidate, snapshot.state.preferences)) : catalog,
    preferences: snapshot.state.preferences, decisions: snapshot.state.decisions, timeZone })
    : [], [catalog, candidateFilter, preferenceKey, decisionKey, timeZone, inventoryStatus]);
  const cashComplete = inventoryStatus === 'ready' && !inventoryPartial;
  const tournamentsComplete = cashComplete && tournamentDataStatus === 'ready' && !tournamentDataPartial;
  const savedGames = useMemo(() => resolveSavedMatchGames({ candidates: catalog, decisions: snapshot.state.decisions,
    catalogComplete: cashComplete, catalogCompleteByKind: { cash: cashComplete, tournament: tournamentsComplete } }),
    [catalog, snapshot.state.decisions, cashComplete, tournamentsComplete]);
  const format = snapshot.state.preferences.format;
  const discoveryStatus = inventoryStatus !== 'ready' || format === 'cash' ? inventoryStatus
    : format === 'tournament' ? tournamentDataStatus : 'ready';
  const discoveryPartial = discoveryStatus === 'ready' && (inventoryPartial
    || format !== 'cash' && (tournamentDataStatus !== 'ready' || tournamentDataPartial));
  return {
    ...snapshot, catalog, ranked, savedGames, scope, timeZone, discoveryStatus, discoveryPartial,
    controller: controllerRef,
    retry: () => { void controllerRef.current?.retry(); }
  };
}
