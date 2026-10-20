import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { createPlayerMatchController, type MatchControllerSnapshot, type MatchPersistencePort } from '../../../player-app/src/application/playerMatchController';
import { usePlayerClubs } from '../../../player-app/src/application/usePlayerClubs';
import { OrbitMatchScreen, type MatchMode } from '../../../player-app/src/features/match/OrbitMatchScreen';
import { GameDetailsScreen } from '../../../player-app/src/features/discovery/DiscoveryGameDetails';
import { SeatRequestModal } from '../../../player-app/src/features/clubs/ClubRoutes';
import { buildMatchCandidates, rankMatchCandidates, resolveSavedMatchGames } from '../../../player-app/src/domain/orbitMatchCandidates';
import { defaultMatchPreferences, type MatchCandidate, type MatchState } from '../../../player-app/src/domain/orbitMatchTypes';
import type { Screen } from '../../../player-app/src/domain/playerTypes';
import type { PlayerClubSnapshot } from '../../../player-app/src/domain/playerSync';
import type { PlayerPlatform } from '../../../player-app/src/app/playerPlatform';
import { qaRequest } from './localTransport';
import { createQaInventory, qaUid } from './fixtures';
import { PlayerThemeProvider, usePlayerTheme } from '../../../player-app/src/styles/PlayerThemeProvider';
import { nativeTextContrast } from '../../../player-app/src/test-utils/nativeContrast';

type QaBridge = { snapshot: () => MatchControllerSnapshot; journalFailure: (enabled: boolean) => void; refreshInventory: () => Promise<void>; contrastFailures: () => { text: string; ratio: number }[] };
declare global { interface Window { __ORBIT_MATCH_QA__: QaBridge; } }
let failJournal = false;
const journalKey = `orbit-match-local-qa-journal:${qaUid}`;
const port: MatchPersistencePort = {
  async loadJournal(uid) { if (uid !== qaUid) throw new Error('Unexpected QA actor'); return JSON.parse(localStorage.getItem(journalKey) ?? 'null'); },
  async saveJournal(uid, journal) { if (uid !== qaUid) throw new Error('Unexpected QA actor'); if (failJournal) throw new Error('QA secure journal write failed'); localStorage.setItem(journalKey, JSON.stringify(journal)); },
  async fetchState() { return (await qaRequest<{ state: MatchState }>('state')).state; },
  async mutate(_uid, operation) { return (await qaRequest<{ state: MatchState }>('operation', operation)).state; },
  subscribe(_uid, onState, onError) {
    let active = true, busy = false;
    const timer = window.setInterval(async () => { if (busy) return; busy = true;
      try { const value = await qaRequest<{ state: MatchState }>('state'); if (active) onState(value.state); }
      catch (failure) { if (active) onError(failure instanceof Error ? failure : new Error('Local QA sync failed')); }
      finally { busy = false; }
    }, 250);
    return () => { active = false; window.clearInterval(timer); };
  }
};
const platform: PlayerPlatform = {
  os: 'web', getCurrentAppState: () => 'active', subscribeToAppState: () => () => undefined,
  openDirections: async () => ({ ok: true }), openAppSettings: async () => undefined,
  confirmAccountDeletion: async () => false, confirmLocalProfileDeletion: async () => false,
  showAccountDeletionResult: () => undefined, showLocalProfileDeletionResult: () => undefined
};

function Harness() {
  const { colors, scheme } = usePlayerTheme();
  useEffect(() => { document.body.style.backgroundColor = colors.canvas; document.documentElement.dataset.playerScheme = scheme; }, [colors.canvas, scheme]);
  const inventory = useRef(createQaInventory());
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>([]);
  const [inventoryStatus, setInventoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [screen, setScreen] = useState<Screen>('findGames');
  const [matchMode, setMatchMode] = useState<MatchMode>('discover');
  const [selected, setSelected] = useState<MatchCandidate | null>(null);
  const [selectedSource, setSelectedSource] = useState<'deck' | 'saved'>('deck');
  const [syncStatus, setSyncStatus] = useState('');
  const [, setSelectedClubId] = useState('');
  const [, setClubMembershipMessage] = useState('');
  const [snapshot, setSnapshot] = useState<MatchControllerSnapshot>();
  const controllerRef = useRef<ReturnType<typeof createPlayerMatchController> | null>(null);
  const refreshInventory = async () => {
    try { const value = await qaRequest<{ clubs: PlayerClubSnapshot[] }>('inventory'); setClubs(value.clubs); setInventoryStatus('ready'); }
    catch { setInventoryStatus('error'); }
  };
  useEffect(() => {
    const controller = createPlayerMatchController({ uid: qaUid, preferences: defaultMatchPreferences, port, createId: () => crypto.randomUUID(), onChange: setSnapshot });
    controllerRef.current = controller;
    window.__ORBIT_MATCH_QA__ = { snapshot: controller.snapshot, journalFailure: (enabled) => { failJournal = enabled; }, refreshInventory,
      contrastFailures: () => Array.from(document.querySelectorAll('[dir="auto"]'))
        .filter((element) => element.getClientRects().length && !element.closest('[aria-hidden="true"], [aria-disabled="true"]'))
        .map((element) => ({ text: element.textContent ?? '', ratio: nativeTextContrast(element) })).filter((item) => item.ratio < 4.5) };
    void controller.start(); void refreshInventory();
    return () => { controller.dispose(); controllerRef.current = null; };
  }, []);
  const actions = usePlayerClubs({ actionsReady: inventoryStatus === 'ready', clockNow: Date.now(), clubs, platform, player: inventory.current.player,
    requireVerifiedAge: () => true, setClubMembershipMessage, setClubs, setScreen, setSelectedClubId, setSyncStatus,
    onSeatRequestSuccess: ({ clubId, gameId, matchAttribution }) => {
      if (matchAttribution?.uid === qaUid) void controllerRef.current?.recordEvent({ kind: 'waitlist-success', ref: { clubId, gameId, kind: 'cash' },
        saveMutationId: matchAttribution.saveMutationId });
    } });
  if (!snapshot) return <Text>Restoring local QA account</Text>;
  const candidates = buildMatchCandidates({ clubs, player: inventory.current.player, activeGameKeys: new Set(clubs.flatMap((club) => club.waitlists.map((entry) => `${club.club.id}:${entry.gameId}`))), nowMs: Date.now(), origin: null });
  const ranked = rankMatchCandidates({ candidates, preferences: snapshot.state.preferences, decisions: snapshot.state.decisions });
  const saved = resolveSavedMatchGames({ candidates, decisions: snapshot.state.decisions, catalogComplete: true });
  const detail = selected && candidates.find((row) => row.ref.clubId === selected.ref.clubId && row.ref.gameId === selected.ref.gameId);
  return <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, maxWidth: 680, width: '100%', alignSelf: 'center', gap: 12 }}>
    <Text style={{ color: colors.muted, fontSize: 12 }}>Engineering QA · fictional venues · localhost only</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Profile Match preferences"
      onPress={() => { setScreen('findGames'); setMatchMode('preferences'); }}
      style={{ alignSelf: 'flex-end', borderColor: colors.line, borderRadius: 12, borderWidth: 1, justifyContent: 'center', minHeight: 44, paddingHorizontal: 12 }}>
      <Text style={{ color: colors.ink }}>Profile · Match preferences</Text>
    </Pressable>
    {screen === 'gameDetails' ? <GameDetailsScreen backLabel="Matches" item={detail?.status === 'inactive' ? null : detail?.opportunity ?? null} player={inventory.current.player}
      activeRequest={detail?.activeRequest} onViewRequest={() => setScreen('findGames')}
      onBack={() => setScreen('findGames')} onDirections={() => setSyncStatus('QA directions handoff only')} onJoin={() => {
        if (!detail?.opportunity) return;
        const record = controllerRef.current?.snapshot().state.decisions.find((row) => row.ref.clubId === detail.ref.clubId && row.ref.gameId === detail.ref.gameId && row.decision === 'saved');
        actions.joinWaitlist(detail.opportunity.club, detail.opportunity.game, selectedSource === 'saved' && record
          ? { uid: qaUid, saveMutationId: record.mutationId, initiatedAt: Date.now() } : undefined);
    }}
      onRefresh={() => { void refreshInventory(); }} readOnly={inventoryStatus !== 'ready'} onViewStore={() => setSyncStatus('QA access options only')} /> : <OrbitMatchScreen mode={matchMode} onModeChange={setMatchMode}
      candidates={ranked} savedGames={saved} inventoryStatus={inventoryStatus} inventoryPartial={false} storageReady={snapshot.ready}
      pending={snapshot.working} error={snapshot.error} canUndo={Boolean(snapshot.state.undo)} preferences={snapshot.state.preferences} preferencesRevision={snapshot.state.preferencesRevision}
      clubs={clubs.map(({ club }) => ({ id: club.id, name: club.name }))}
      onDecision={(candidate, decision) => { void controllerRef.current?.decide(candidate.ref, candidate.summary, decision); }} onUndo={() => { void controllerRef.current?.undo(); }}
      onRemoveSaved={(record) => { void controllerRef.current?.remove(record); }} onDetails={(candidate, source) => {
        setSelected(candidate); setSelectedSource(source); setScreen('gameDetails');
        const record = snapshot.state.decisions.find((row) => row.ref.clubId === candidate.ref.clubId && row.ref.gameId === candidate.ref.gameId && row.decision === 'saved');
        void controllerRef.current?.recordEvent({ kind: source === 'saved' ? 'saved-revisit' : 'details', ref: candidate.ref, ...(record ? { saveMutationId: record.mutationId } : {}) });
      }} onPreferences={(preferences, revision) => controllerRef.current?.preferences(preferences, revision) ?? false} onRetry={() => { void controllerRef.current?.retry(); void refreshInventory(); }} />}
    {syncStatus ? <Text accessibilityLiveRegion="polite" style={{ color: colors.muted }}>{syncStatus}</Text> : null}
    <SeatRequestModal draft={actions.seatRequestDraft} message={actions.seatRequestMessage} busy={actions.clubActionPending}
      onChange={actions.setSeatRequestDraft} onClose={() => actions.setSeatRequestDraft(null)} onSubmit={() => { void actions.submitSeatRequest(); }} />
  </ScrollView>;
}
createRoot(document.getElementById('root')!).render(<PlayerThemeProvider><Harness /></PlayerThemeProvider>);
