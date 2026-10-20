/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMatchOperation, createMatchState } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import type { MatchJournal, MatchOperation } from '../domain/orbitMatchTypes';
import { usePlayerMatch } from './usePlayerMatch';
import { createDemoPlayerData } from '../demo/demoPlayerData';
import * as candidates from '../domain/orbitMatchCandidates';

const boundary = vi.hoisted(() => ({
  journals: new Map<string, MatchJournal>(), load: vi.fn(), save: vi.fn(), createId: vi.fn(),
  remoteLoad: vi.fn(), remoteSave: vi.fn(), fetchState: vi.fn(), mutate: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn()
}));
vi.mock('../data/storage/playerStorage', () => ({ playerStorage: { loadMatchJournal: boundary.load, saveMatchJournal: boundary.save } }));
vi.mock('../data/firebase/playerMatchRepository', () => ({ playerMatchPersistence: {
  loadJournal: boundary.remoteLoad, saveJournal: boundary.remoteSave, fetchState: boundary.fetchState,
  mutate: boundary.mutate, subscribe: boundary.subscribe
} }));
vi.mock('../security/secureIdentifier', () => ({ createSecureUuid: boundary.createId }));

const ref = { clubId: 'venue-one', gameId: 'game-one', kind: 'cash' as const };
const summary = { venueName: 'Example Venue', gameName: '1/2 NLH' };
async function settle() { for (let index = 0; index < 30; index += 1) await Promise.resolve(); }

describe('Match hook owner and device boundaries', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let input: Parameters<typeof usePlayerMatch>[0] & {
    tournamentDataStatus?: 'idle' | 'loading' | 'ready' | 'error';
    tournamentDataPartial?: boolean;
  };
  let result: ReturnType<typeof usePlayerMatch> | undefined;
  function Harness() { result = usePlayerMatch(input); return null; }
  const current = () => { if (!result) throw new Error('Hook did not mount'); return result; };
  const render = async () => {
    await act(async () => { root.render(<Harness />); mounted = true; });
    await act(async () => { await settle(); });
  };
  const unmount = () => { if (mounted) act(() => root.unmount()); mounted = false; };
  function publishedCatalog() {
    const demo = createDemoPlayerData(input.nowMs);
    const club = demo.clubs[0];
    const tournament = demo.tournaments.find((event) => event.clubId === club.club.id);
    if (!tournament) throw new Error('Missing scheduled fixture at the published venue');
    input = { ...input, clubs: [club], tournaments: [tournament], tournamentDataStatus: 'ready', tournamentDataPartial: false };
    return { club, tournament };
  }
  async function savePublished(kind: 'cash' | 'tournament') {
    const candidate = current().catalog.find((item) => item.ref.kind === kind);
    const controller = current().controller.current;
    if (!candidate || !controller) throw new Error('Missing published candidate or controller');
    await act(async () => { await controller.decide(candidate.ref, candidate.summary, 'saved'); await settle(); });
    return candidate;
  }


  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    vi.clearAllMocks();
    boundary.journals.clear();
    let id = 0;
    boundary.createId.mockImplementation(() => `hook-mutation-${String(++id).padStart(16, '0')}`);
    const load = async (uid: string) => boundary.journals.get(uid) ?? null;
    const save = async (uid: string, journal: MatchJournal) => { boundary.journals.set(uid, structuredClone(journal)); };
    boundary.load.mockImplementation(load);
    boundary.save.mockImplementation(save);
    boundary.remoteLoad.mockImplementation(load);
    boundary.remoteSave.mockImplementation(save);
    boundary.fetchState.mockImplementation(async () => createMatchState());
    boundary.mutate.mockImplementation(async (_uid: string, operation: MatchOperation) => applyMatchOperation(createMatchState(), operation));
    boundary.subscribe.mockReturnValue(boundary.unsubscribe);
    input = {
      player: { id: 'uid-one', name: 'Player One', email: 'one@example.test', preferredGameIds: [] },
      authenticatedUid: null, demoMode: false, enabled: true, clubs: [], tournaments: [],
      activeGameKeys: new Set(), origin: null, nowMs: Date.parse('2026-10-12T12:00:00.000Z'),
      inventoryStatus: 'ready', inventoryPartial: false
    };
    result = undefined;
    mounted = false;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => { unmount(); container.remove(); vi.restoreAllMocks(); });

  it('isolates device-only saves from an authenticated owner journal with pending operations', async () => {
    const pending: MatchOperation = { mutationId: 'account-pending-000001', type: 'decide', ref, summary, decision: 'saved' };
    const authenticated: MatchJournal = { uid: 'uid-one', confirmed: createMatchState(), pending: [pending] };
    boundary.journals.set('uid-one', structuredClone(authenticated));
    await render();
    expect(current()).toMatchObject({ scope: 'device', ready: true });
    expect(boundary.load).toHaveBeenCalledExactlyOnceWith('device:uid-one');
    expect(current().state.decisions).toEqual([]);
    await act(async () => {
      await current().controller.current?.decide({ ...ref, gameId: 'local-game' }, summary, 'saved');
      await settle();
    });
    expect(boundary.journals.get('uid-one')).toEqual(authenticated);
    expect(boundary.journals.get('device:uid-one')?.confirmed?.decisions[0].ref.gameId).toBe('local-game');
    expect(boundary.mutate).not.toHaveBeenCalled();
    expect(boundary.fetchState).not.toHaveBeenCalled();
  });

  it('keeps demo saves entirely in memory', async () => {
    input = { ...input, demoMode: true };
    await render();
    await act(async () => {
      await current().controller.current?.decide(ref, summary, 'saved');
      await settle();
    });
    expect(current().state.decisions).toHaveLength(1);
    expect(boundary.load).not.toHaveBeenCalled();
    expect(boundary.save).not.toHaveBeenCalled();
    expect(boundary.remoteLoad).not.toHaveBeenCalled();
    expect(boundary.mutate).not.toHaveBeenCalled();
  });

  it('does not reuse or publish another owner result when authentication changes during a fetch', async () => {
    let resolveFirst!: (value: ReturnType<typeof createMatchState>) => void;
    const first = new Promise<ReturnType<typeof createMatchState>>((resolve) => { resolveFirst = resolve; });
    const secondState = createMatchState();
    secondState.preferences.favoriteClubIds = ['owner-two-venue'];
    boundary.fetchState.mockImplementation(async (uid: string) => uid === 'uid-one' ? first : secondState);
    input = { ...input, authenticatedUid: 'uid-one' };
    await render();
    input = { ...input, player: { ...input.player, id: 'uid-two', name: 'Player Two' }, authenticatedUid: 'uid-two' };
    await render();
    const stale = createMatchState();
    stale.preferences.favoriteClubIds = ['owner-one-venue'];
    await act(async () => { resolveFirst(stale); await settle(); });
    expect(current()).toMatchObject({ scope: 'account', ready: true });
    expect(current().state.preferences.favoriteClubIds).toEqual(['owner-two-venue']);
    expect(boundary.journals.has('uid-one')).toBe(false);
    expect(boundary.journals.get('uid-two')?.confirmed).toEqual(secondState);
  });

  it('disposes the authenticated subscription when unmounted', async () => {
    input = { ...input, authenticatedUid: 'uid-one' };
    await render();
    expect(boundary.subscribe).toHaveBeenCalledOnce();
    unmount();
    expect(boundary.unsubscribe).toHaveBeenCalledOnce();
  });
  it('reuses ranked recommendations across telemetry snapshots while preferences, decisions and live catalog changes still reconcile', async () => {
    const rank = vi.spyOn(candidates, 'rankMatchCandidates');
    const demo = createDemoPlayerData(input.nowMs);
    input = { ...input, clubs: [demo.clubs[0]], timeZone: 'America/Chicago' };
    await render();
    const first = current().ranked;
    const beforeEvent = rank.mock.calls.length;
    expect(first.length).toBeGreaterThan(0);
    await act(async () => { await current().controller.current?.recordEvent({ kind: 'opened' }); await settle(); });
    expect(current().state.events).toHaveLength(1);
    expect(rank).toHaveBeenCalledTimes(beforeEvent);
    expect(current().ranked).toBe(first);

    await act(async () => { await current().controller.current?.preferences({ ...current().state.preferences, variants: ['plo'] }); await settle(); });
    expect(rank.mock.calls.length).toBeGreaterThan(beforeEvent);
    const beforeDecision = rank.mock.calls.length;
    const saved = current().ranked[0];
    await act(async () => { await current().controller.current?.decide(saved.ref, saved.summary, 'saved'); await settle(); });
    expect(rank.mock.calls.length).toBeGreaterThan(beforeDecision);
    expect(current().ranked.some((item) => item.ref.gameId === saved.ref.gameId)).toBe(false);
    expect(current().savedGames).toHaveLength(1);

    const remaining = current().ranked[0];
    const updated = structuredClone(input.clubs);
    const table = updated[0].games.find((game) => game.id === remaining.ref.gameId)?.openTables[0];
    if (!table) throw new Error('Missing published game table');
    table.status = 'Running'; table.availableSeats = 1; table.seatsFilled = table.maxSeats - 1;
    const beforeInventory = rank.mock.calls.length;
    input = { ...input, clubs: updated };
    await render();
    expect(rank.mock.calls.length).toBeGreaterThan(beforeInventory);
    expect(current().ranked.find((item) => item.ref.gameId === remaining.ref.gameId)?.availableSeats).toBe(1);
  });
  it('ranks published schedule preferences using the selected device zone and changes ranking when that zone changes', async () => {
    const demo = createDemoPlayerData(input.nowMs);
    const tournament = { ...demo.tournaments[0], startsAt: '2030-10-15T01:00:00.000Z' };
    input = { ...input, clubs: [demo.clubs[0]], tournaments: [tournament], timeZone: 'America/Chicago' };
    await render();
    await act(async () => { await current().controller.current?.preferences({ ...current().state.preferences, format: 'tournament', preferredTime: 'evening' }); await settle(); });
    expect(current()).toMatchObject({ timeZone: 'America/Chicago' });
    expect(current().ranked[0].components.availability).toBe(1);
    input = { ...input, timeZone: 'UTC' };
    await render();
    expect(current().ranked[0].components.availability).toBe(0);
  });
  it('characterizes a confirmed mixed catalogue and saved scheduled-event binding without invented capacity', async () => {
    const { tournament } = publishedCatalog();
    await render();
    expect(current().ranked.some((item) => item.ref.kind === 'cash')).toBe(true);
    const scheduled = current().ranked.find((item) => item.ref.kind === 'tournament');
    expect(scheduled).toMatchObject({ ref: { gameId: tournament.id }, status: 'scheduled', availableSeats: null, waitlistCount: null });
    await savePublished('tournament');
    expect(current().savedGames).toHaveLength(1);
    expect(current().savedGames[0]).toMatchObject({ record: { ref: { gameId: tournament.id } }, candidate: { tournament }, unavailableReason: null });
  });

  it('characterizes legacy completeness fallback for missing saved cash and events without discarding either decision', async () => {
    publishedCatalog();
    delete input.tournamentDataStatus;
    delete input.tournamentDataPartial;
    await render();
    await savePublished('cash');
    await savePublished('tournament');
    const decisions = structuredClone(current().state.decisions);
    input = { ...input, clubs: [], tournaments: [], inventoryPartial: true };
    await render();
    expect(current().savedGames).toHaveLength(2);
    expect(current().savedGames.every((item) => item.candidate === null && item.unavailableReason?.includes('has not loaded'))).toBe(true);
    input = { ...input, inventoryPartial: false };
    await render();
    expect(current().savedGames.every((item) => item.candidate === null && item.unavailableReason?.includes('no longer'))).toBe(true);
    expect(current().state.decisions).toEqual(decisions);
  });

  it('characterizes retained cash detail data and saves while venue confirmation is pending', async () => {
    publishedCatalog();
    input = { ...input, tournaments: [] };
    await render();
    const saved = await savePublished('cash');
    const decisions = structuredClone(current().state.decisions);
    for (const inventoryStatus of ['loading', 'error'] as const) {
      input = { ...input, inventoryStatus };
      await render();
      expect(current().catalog.some((item) => item.ref.gameId === saved.ref.gameId)).toBe(true);
      expect(current().savedGames[0].candidate?.ref).toEqual(saved.ref);
      expect(current().state.decisions).toEqual(decisions);
    }
  });

  it.each(['idle', 'loading', 'error'] as const)('keeps fresh cash usable while %s event data removes stale event actions without losing saves', async (tournamentDataStatus) => {
    publishedCatalog();
    await render();
    const cash = await savePublished('cash');
    const event = await savePublished('tournament');
    const decisions = structuredClone(current().state.decisions);
    input = { ...input, tournamentDataStatus };
    await render();
    expect(current().ranked.length).toBeGreaterThan(0);
    expect(current().ranked.every((item) => item.ref.kind === 'cash')).toBe(true);
    expect(current().catalog.some((item) => item.ref.kind === 'tournament')).toBe(false);
    expect(current().savedGames.find((item) => item.record.ref.kind === 'cash')).toMatchObject({ candidate: { ref: cash.ref }, unavailableReason: null });
    const savedEvent = current().savedGames.find((item) => item.record.ref.kind === 'tournament');
    expect(savedEvent).toMatchObject({ record: { ref: event.ref }, candidate: null });
    expect(savedEvent?.unavailableReason).toContain('has not loaded');
    expect(current().state.decisions).toEqual(decisions);
  });

  it('ranks a confirmed partial event prefix while an omitted saved event stays not-loaded until completion', async () => {
    const { tournament } = publishedCatalog();
    await render();
    await savePublished('tournament');
    const nextEvent = { ...tournament, id: tournament.id + '-next', name: 'Second published scheduled event' };
    input = { ...input, tournaments: [nextEvent], tournamentDataPartial: true };
    await render();
    expect(current().ranked.find((item) => item.ref.gameId === nextEvent.id)).toMatchObject({ status: 'scheduled', availableSeats: null, waitlistCount: null });
    expect(current().savedGames[0].candidate).toBeNull();
    expect(current().savedGames[0].unavailableReason).toContain('has not loaded');
    input = { ...input, tournamentDataPartial: false };
    await render();
    expect(current().savedGames[0].unavailableReason).toContain('no longer');
  });

  it('declares a missing cash save absent independently while an unconfirmed event save remains not-loaded', async () => {
    const { club } = publishedCatalog();
    await render();
    await savePublished('cash');
    await savePublished('tournament');
    const decisions = structuredClone(current().state.decisions);
    input = { ...input, clubs: [{ ...club, games: [] }], tournaments: [], tournamentDataStatus: 'loading' };
    await render();
    expect(current().savedGames.find((item) => item.record.ref.kind === 'cash')?.unavailableReason).toContain('no longer');
    expect(current().savedGames.find((item) => item.record.ref.kind === 'tournament')?.unavailableReason).toContain('has not loaded');
    expect(current().state.decisions).toEqual(decisions);
  });

  it.each(['loading', 'error'] as const)('retains cash detail records but ranks neither kind or stale event actions while venues are %s', async (inventoryStatus) => {
    publishedCatalog();
    await render();
    await savePublished('tournament');
    const decisions = structuredClone(current().state.decisions);
    input = { ...input, inventoryStatus };
    await render();
    expect(current().catalog.some((item) => item.ref.kind === 'cash')).toBe(true);
    expect(current().ranked).toEqual([]);
    expect(current().catalog.some((item) => item.ref.kind === 'tournament')).toBe(false);
    expect(current().savedGames[0].candidate).toBeNull();
    expect(current().savedGames[0].unavailableReason).toContain('has not loaded');
    expect(current().state.decisions).toEqual(decisions);
  });

  it.each([
    ['cash', 'error', 'ready', false],
    ['tournament', 'loading', 'loading', undefined],
    ['tournament', 'error', 'error', undefined],
    ['any', 'loading', 'ready', true],
    ['any', 'error', 'ready', true]
  ] as const)('derives %s discovery status independently with an event feed in %s', async (format, tournamentDataStatus, discoveryStatus, discoveryPartial) => {
    publishedCatalog();
    input = { ...input, tournamentDataStatus };
    await render();
    const controller = current().controller.current;
    if (!controller) throw new Error('Missing Match controller');
    await act(async () => { await controller.preferences({ ...current().state.preferences, format }); await settle(); });
    expect(current()).toMatchObject({ discoveryStatus });
    if (discoveryPartial !== undefined) expect(current()).toMatchObject({ discoveryPartial });
  });

});
