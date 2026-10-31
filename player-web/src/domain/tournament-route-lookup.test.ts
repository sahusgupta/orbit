import { describe, expect, it } from 'vitest';
import { findTournamentByRouteKey, tournamentRouteKey } from './selectors';
import type { DiscoveryPayload, PlayerClubSnapshot, PlayerTournament } from './types';
import { clubAlpha, clubBeta, openTournament } from '@/tests/fixtures';

function payload(clubs: PlayerClubSnapshot[], tournaments: PlayerTournament[]): DiscoveryPayload {
  return { clubs, tournaments, interests: [], page: { count: clubs.length, hasMore: false, nextCursor: null } };
}

function club(id: string, name = id): PlayerClubSnapshot {
  return { ...clubAlpha, club: { ...clubAlpha.club, id, name } };
}

function event(id: string, clubId: string, name = 'Published event'): PlayerTournament {
  return { ...openTournament, id, clubId, name };
}

function measuredInventory(clubCount: number, tournamentCount: number, targetClubIndex = clubCount - 1) {
  const measurements = { clubIdReads: 0 };
  const clubs = Array.from({ length: clubCount }, (_, index): PlayerClubSnapshot => ({
    ...clubAlpha,
    club: { ...clubAlpha.club, name: `Venue ${index}`, get id() {
      measurements.clubIdReads += 1;
      return `venue-${index}`;
    } }
  }));
  const tournaments = Array.from({ length: tournamentCount }, (_, index) =>
    event(`event-${index}`, `venue-${targetClubIndex}`, `Published event ${index}`));
  return { discovery: payload(clubs, tournaments), measurements };
}

describe('tournament route lookup characterization', () => {
  it('gives a canonical match priority over an earlier unique raw-ID match', () => {
    const selected = event('selected-event', clubAlpha.club.id);
    const key = tournamentRouteKey(clubAlpha, selected);
    const rawCollision = event(key, clubBeta.club.id, 'Different event');
    expect(findTournamentByRouteKey(payload([clubAlpha, clubBeta], [rawCollision, selected]), key)).toBe(selected);
  });

  it('returns the first canonical match and preserves its original object identity', () => {
    const first = event('duplicated-event', clubAlpha.club.id);
    const second = { ...first, prizePoolLabel: 'Later published record' };
    const source = payload([clubAlpha], [first, second]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(clubAlpha, first))).toBe(first);
  });

  it('uses raw IDs only when exactly one tournament matches', () => {
    const first = event('shared-event', clubAlpha.club.id);
    const second = event(first.id, clubBeta.club.id, 'Other venue event');
    expect(findTournamentByRouteKey(payload([clubAlpha, clubBeta], [first]), first.id)).toBe(first);
    expect(findTournamentByRouteKey(payload([clubAlpha, clubBeta], [first, second]), first.id)).toBeUndefined();
    expect(findTournamentByRouteKey(payload([clubAlpha], [first, first]), first.id)).toBeUndefined();
  });

  it('keeps canonical routes distinct across clubs even when raw IDs collide', () => {
    const first = event('shared-event', clubAlpha.club.id);
    const second = event(first.id, clubBeta.club.id, first.name);
    const source = payload([clubAlpha, clubBeta], [first, second]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(clubBeta, second))).toBe(second);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(clubAlpha, first))).toBe(first);
  });

  it('keeps the first club snapshot when duplicate club IDs have different names', () => {
    const first = club('duplicate-club', 'First published venue');
    const later = club(first.club.id, 'Later published venue');
    const selected = event('event', first.club.id);
    const source = payload([first, later], [selected]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(first, selected))).toBe(selected);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(later, selected))).toBeUndefined();
  });

  it('keeps the first duplicate club even after a prior event requires visiting later clubs', () => {
    const first = club('duplicate-club', 'First published venue');
    const later = club(first.club.id, 'Later published venue');
    const last = club('last-club', 'Last venue');
    const selected = event('selected-event', first.club.id);
    const source = payload([first, later, last], [event('earlier-event', last.club.id), selected]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(first, selected))).toBe(selected);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(later, selected))).toBeUndefined();
  });

  it('retains the orbit canonical fallback and unique raw lookup for an orphan event', () => {
    const orphan = event('orphan-event', 'missing-club');
    const source = payload([clubAlpha], [orphan]);
    const orbitKey = tournamentRouteKey(undefined, orphan);
    expect(orbitKey).toMatch(/^published-event-orbit--/);
    expect(findTournamentByRouteKey(source, orbitKey)).toBe(orphan);
    expect(findTournamentByRouteKey(source, orphan.id)).toBe(orphan);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(clubAlpha, orphan))).toBeUndefined();
  });

  it('finds a later known-club event after first considering an orphan event', () => {
    const orphan = event('orphan-event', 'missing-club');
    const selected = event('known-event', clubBeta.club.id);
    const source = payload([clubAlpha, clubBeta], [orphan, selected]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(clubBeta, selected))).toBe(selected);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(undefined, orphan))).toBe(orphan);
  });

  it.each([
    ['__proto__', 'constructor'], ['constructor', '__proto__'], ['a:b', 'c'], ['a', 'b:c'], ['', '']
  ])('preserves raw club/event scope %j / %j', (clubId, eventId) => {
    const venue = club(clubId, 'Published venue');
    const selected = event(eventId, clubId);
    const source = payload([venue], [selected]);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(venue, selected))).toBe(selected);
    expect(findTournamentByRouteKey(source, eventId)).toBe(selected);
  });

  it('does not mutate frozen input arrays, snapshots or events', () => {
    const venue = club('frozen-club', 'Frozen venue');
    const selected = event('frozen-event', venue.club.id);
    const source = payload([venue], [selected]);
    const before = JSON.stringify(source);
    Object.freeze(venue.club);
    Object.freeze(venue);
    Object.freeze(selected);
    Object.freeze(source.clubs);
    Object.freeze(source.tournaments);
    Object.freeze(source);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(venue, selected))).toBe(selected);
    expect(JSON.stringify(source)).toBe(before);
  });

  it('rebuilds lookup state for each call after venue renames and duplicate reordering', () => {
    const first = club('mutable-club', 'Original venue');
    const later = club(first.club.id, 'Later venue');
    const selected = event('event', first.club.id);
    const source = payload([first, later], [selected]);
    const originalKey = tournamentRouteKey(first, selected);
    expect(findTournamentByRouteKey(source, originalKey)).toBe(selected);
    first.club.name = 'Renamed venue';
    expect(findTournamentByRouteKey(source, originalKey)).toBeUndefined();
    expect(findTournamentByRouteKey(source, tournamentRouteKey(first, selected))).toBe(selected);
    source.clubs.reverse();
    expect(findTournamentByRouteKey(source, tournamentRouteKey(later, selected))).toBe(selected);
    expect(findTournamentByRouteKey(source, tournamentRouteKey(first, selected))).toBeUndefined();
  });

  it('returns undefined for missing routes or empty event inventory', () => {
    expect(findTournamentByRouteKey(payload([clubAlpha], [openTournament]), 'not-a-route')).toBeUndefined();
    expect(findTournamentByRouteKey(payload([clubAlpha], []), 'not-a-route')).toBeUndefined();
    expect(findTournamentByRouteKey(payload([], []), '')).toBeUndefined();
  });

  it('records club-ID access cost without making repeated scans a behavior contract', () => {
    const { discovery, measurements } = measuredInventory(128, 512);
    expect(findTournamentByRouteKey(discovery, 'not-a-route')).toBeUndefined();
    console.info(JSON.stringify({ measurement: 'tournament-route-club-id-reads', scenario: 'missing-route',
      clubs: 128, tournaments: 512, clubIdReads: measurements.clubIdReads }));
    measurements.clubIdReads = 0;
    const selected = discovery.tournaments.at(-1);
    if (!selected) throw new Error('Expected a populated synthetic event fixture.');
    const key = tournamentRouteKey(discovery.clubs.at(-1), selected);
    expect(findTournamentByRouteKey(discovery, key)).toBe(selected);
    console.info(JSON.stringify({ measurement: 'tournament-route-club-id-reads', scenario: 'last-route',
      clubs: 128, tournaments: 512, clubIdReads: measurements.clubIdReads }));
  });
});

describe('tournament route lookup resource budgets', () => {
  it.each(['missing-route', 'last-route'])('bounds club-ID inspection linearly for %s', (scenario) => {
    const { discovery, measurements } = measuredInventory(128, 512);
    const selected = discovery.tournaments.at(-1);
    if (!selected) throw new Error('Expected a populated synthetic event fixture.');
    const key = scenario === 'missing-route' ? 'not-a-route' : tournamentRouteKey(discovery.clubs.at(-1), selected);
    expect(findTournamentByRouteKey(discovery, key)).toBe(scenario === 'missing-route' ? undefined : selected);
    console.info(JSON.stringify({ measurement: 'tournament-route-linear-budget', scenario,
      clubs: 128, tournaments: 512, clubIdReads: measurements.clubIdReads, maximumClubIdReads: 256 }));
    expect(measurements.clubIdReads).toBeLessThanOrEqual(256);
  });

  it('keeps an early first-club route cheap and does not inspect the event tail', () => {
    const { discovery, measurements } = measuredInventory(128, 512, 0);
    let tailEventReads = 0;
    const tail = { ...discovery.tournaments[1], get clubId() {
      tailEventReads += 1;
      return 'venue-127';
    } };
    discovery.tournaments[1] = tail;
    const selected = discovery.tournaments[0];
    expect(findTournamentByRouteKey(discovery, tournamentRouteKey(discovery.clubs[0], selected))).toBe(selected);
    expect(measurements.clubIdReads).toBe(1);
    expect(tailEventReads).toBe(0);
  });

  it('does not inspect any club ID for empty event inventory', () => {
    const { discovery, measurements } = measuredInventory(128, 0);
    expect(findTournamentByRouteKey(discovery, 'not-a-route')).toBeUndefined();
    expect(measurements.clubIdReads).toBe(0);
  });

  it('bounds total club inspection across reverse-ordered distinct event club IDs', () => {
    const { discovery, measurements } = measuredInventory(128, 128);
    discovery.tournaments.forEach((tournament, index) => {
      tournament.clubId = `venue-${127 - index}`;
    });
    const selected = discovery.tournaments.at(-1);
    if (!selected) throw new Error('Expected a populated synthetic event fixture.');
    const key = tournamentRouteKey(discovery.clubs[0], selected);
    expect(findTournamentByRouteKey(discovery, key)).toBe(selected);
    console.info(JSON.stringify({ measurement: 'tournament-route-linear-budget', scenario: 'reverse-distinct-clubs',
      clubs: 128, tournaments: 128, clubIdReads: measurements.clubIdReads, maximumClubIdReads: 256 }));
    expect(measurements.clubIdReads).toBeLessThanOrEqual(256);
  });
});
