import { describe, expect, it } from 'vitest';
import { createDemoPlayerData } from '../demo/demoPlayerData';
import { defaultMatchPreferences, matchReferenceKey, type MatchCandidate, type MatchDecision, type MatchPreferences } from './orbitMatchTypes';
import { buildMatchCandidates, defaultMatchWeights, normalizeMatchGameName, rankMatchCandidates, resolveSavedMatchGames, scoreMatchAvailability, scoreMatchBuyIn, scoreMatchProximity, scoreMatchStakes, scoreMatchVariant, scoreMatchVenue } from './orbitMatchCandidates';

const nowMs = Date.parse('2026-10-12T12:00:00.000Z');
const data = createDemoPlayerData(nowMs);
const catalog = () => buildMatchCandidates({ ...data, activeGameKeys: new Set(['demo-austin:demo-austin-nlh-1-2']), nowMs, origin: data.clubs[0].club.coordinate ?? null });
const prefs = (overrides: Partial<MatchPreferences> = {}): MatchPreferences => ({ ...defaultMatchPreferences, ...overrides });
const candidate = (id: string, overrides: Partial<MatchCandidate> = {}): MatchCandidate => ({
  ref: { clubId: `club-${id}`, gameId: id, kind: 'cash' },
  summary: { venueName: `Venue ${id}`, gameName: '1/2 NLH' },
  opportunity: null, tournament: null, variant: 'nlh', bigBlind: 2, buyIn: null,
  distanceMiles: 5, status: 'live', availableSeats: 2, waitlistCount: 0, publishedAt: null,
  ...overrides
});
const decision = (item: MatchCandidate, status: 'saved' | 'passed' = 'saved'): MatchDecision => ({ ref: item.ref, summary: item.summary, decision: status, mutationId: 'mutation-one', decidedAt: new Date(nowMs).toISOString() });
const scheduled = (id: string, startsAt: string) => candidate(id, {
  ref: { clubId: `club-${id}`, gameId: id, kind: 'tournament' }, status: 'scheduled', distanceMiles: null, variant: null, bigBlind: null,
  availableSeats: null, waitlistCount: null, tournament: { ...data.tournaments[0], id, clubId: `club-${id}`, startsAt }
});

describe('Orbit Match canonical candidate facts', () => {
  it.each([
    ['1/2 NLH', 'nlh', 2], ['$2/$5 No Limit Holdem', 'nlh', 5],
    ['1/2 Pot Limit Omaha', 'plo', 2], ['4/8 Limit Holdem', 'limit-holdem', 8],
    ['4/8 Mixed Games', 'mixed', 8]
  ] as const)('normalizes explicit %s labels', (name, variant, bigBlind) => {
    expect(normalizeMatchGameName(name)).toEqual({ variant, bigBlind });
  });
  it('does not infer variants or blinds from ambiguous and unsupported names', () => {
    for (const name of ['Omaha', 'Holdem', 'PLO Hi-Lo', 'PLO 5 Card', 'Mystery game']) expect(normalizeMatchGameName(name).variant).toBeNull();
    for (const name of ['1/2/5 NLH', '$1/$2/$5 NLH', '-1/2 NLH', '0/2 NLH', '2/1 NLH', '1/2 and 2/5 NLH', 'NLH']) expect(normalizeMatchGameName(name).bigBlind).toBeNull();
  });
  it('keeps the full catalog for saves/details while distinguishing live, forming, paused and scheduled', () => {
    const all = catalog();
    expect(all).toHaveLength(12);
    expect(all.find((item) => item.ref.gameId === 'demo-austin-nlh-1-2')?.activeRequest).toBe(true);
    expect(new Set(all.map((item) => item.status))).toEqual(new Set(['live', 'forming', 'paused', 'scheduled']));
    expect(all.filter((item) => item.status === 'scheduled').every((item) => item.availableSeats === null && item.opportunity === null)).toBe(true);
    expect(all.find((item) => item.status === 'forming')?.availableSeats).toBe(0);
    expect(all.filter((item) => item.ref.kind === 'cash').every((item) => item.buyIn === null && item.publishedAt === new Date(nowMs).toISOString())).toBe(true);
    expect(rankMatchCandidates({ candidates: all, preferences: prefs({ format: 'cash' }), decisions: [] })).toHaveLength(6);
  });
  it('does not show contradictory or wrong-game table capacity as live', () => {
    const altered = createDemoPlayerData(nowMs);
    altered.clubs[0].games[0].openTables[0].availableSeats = 9;
    altered.clubs[1].games[0].openTables[0].gameId = 'foreign-game';
    const all = buildMatchCandidates({ ...altered, activeGameKeys: new Set(), nowMs, origin: null });
    expect(all.find((item) => item.ref.gameId === 'demo-austin-nlh-1-2')).toMatchObject({ status: 'inactive', availableSeats: null });
    expect(all.find((item) => item.ref.gameId === 'demo-chicago-nlh-2-5')?.status).toBe('inactive');
    expect(rankMatchCandidates({ candidates: all, preferences: prefs(), decisions: [] }).some((item) => item.status === 'inactive')).toBe(false);
  });
  it('deduplicates repeated public page references without merging games from different venues', () => {
    const all = buildMatchCandidates({ clubs: [...data.clubs, ...data.clubs], player: data.player, activeGameKeys: new Set(), nowMs, origin: null });
    expect(all).toHaveLength(8);
    expect(new Set(all.map((item) => matchReferenceKey(item.ref))).size).toBe(8);
  });
});

describe('Explainable weighted Orbit Match ranking', () => {
  it('uses the configurable 30/25/20/15/10 weights and exposes independent normalized components', () => {
    expect(defaultMatchWeights).toEqual({ stakes: 30, proximity: 25, variant: 20, availability: 15, venue: 10 });
    const exact = candidate('exact', { distanceMiles: 0 });
    const [result] = rankMatchCandidates({ candidates: [exact], preferences: prefs({ stakes: { minBigBlind: 2, maxBigBlind: 5 }, variants: ['nlh'], favoriteClubIds: ['club-exact'] }), decisions: [] });
    expect(result.components).toEqual({ stakes: 1, proximity: 1, variant: 1, availability: 1, venue: 1 });
    expect(result.score).toBe(100);
    expect(result.reasons).toEqual(['Within your preferred stakes range.', '0.0 miles from your selected location.']);
    expect(rankMatchCandidates({ candidates: [exact], preferences: prefs(), decisions: [], weights: { proximity: 100, availability: 0, stakes: 0, variant: 0, venue: 0 } })[0].score).toBe(100);
  });
  it('rejects finite custom weights whose combined total overflows the ranking scale', () => {
    expect(() => rankMatchCandidates({
      candidates: [candidate('overflow')], preferences: prefs(), decisions: [],
      weights: { stakes: 1e308, proximity: 1e308, variant: 1e308, availability: 1e308, venue: 1e308 }
    })).toThrow(RangeError);
  });
  it('keeps exploration finite and bounded when a valid venue-only weight is very large', () => {
    const fresh = candidate('fresh', { distanceMiles: null, variant: null, bigBlind: null, availableSeats: null, waitlistCount: null });
    const preferences = prefs({ favoriteClubIds: ['club-favorite'], exploreNewVenues: true });
    const run = (venue: number) => rankMatchCandidates({
      candidates: [fresh], preferences, decisions: [],
      weights: { stakes: 0, proximity: 0, variant: 0, availability: 0, venue }
    })[0];
    const normal = run(100);
    const large = run(1e308);
    expect(large.components).toEqual(normal.components);
    expect(large.score).toBeCloseTo(normal.score);
    expect(large.score).toBeLessThanOrEqual(5);
    expect(large.reasons).toEqual(['Outside your favorite and currently saved venues.']);
  });
  it('scores nearby distances and partial stakes smoothly rather than exact strings or distance buckets', () => {
    expect(scoreMatchProximity(1, 50)).toBeGreaterThan(scoreMatchProximity(2, 50));
    expect(scoreMatchStakes(2, { minBigBlind: 2, maxBigBlind: 5 })).toBe(1);
    expect(scoreMatchStakes(1, { minBigBlind: 2, maxBigBlind: 5 })).toBe(0.5);
    expect(scoreMatchStakes(10, { minBigBlind: 2, maxBigBlind: 5 })).toBe(0.5);
    expect(scoreMatchVariant('plo', ['nlh'])).toBe(0);
    expect(scoreMatchVenue('other', ['favorite'])).toBe(0);
  });
  it('uses published tournament buy-in compatibility in the existing cost factor without guessing cash buy-in or tournament blinds', () => {
    const event = scheduled('event', '2030-10-13T18:00:00Z');
    const preferences = prefs({ buyIn: { min: 50, max: 150 }, stakes: { minBigBlind: 1, maxBigBlind: 5 } });
    const run = (buyIn: number | null) => rankMatchCandidates({ candidates: [{ ...event, buyIn, bigBlind: 2 }], preferences, decisions: [] })[0];
    expect(scoreMatchBuyIn(100, preferences.buyIn)).toBe(1);
    expect(scoreMatchBuyIn(25, preferences.buyIn)).toBe(0.5);
    expect(scoreMatchBuyIn(300, preferences.buyIn)).toBe(0.5);
    expect(scoreMatchBuyIn(null, preferences.buyIn)).toBe(0);
    expect(scoreMatchBuyIn(0, { min: 0, max: 0 })).toBe(1);
    expect(run(100)).toMatchObject({ score: 30, components: { stakes: 1 }, reasons: ['Published buy-in is within your preferred range.'] });
    expect(run(300)).toMatchObject({ score: 15, components: { stakes: 0.5 }, reasons: [] });
    expect(run(null)).toMatchObject({ score: 0, components: { stakes: 0 }, reasons: [] });
    expect(rankMatchCandidates({ candidates: [{ ...event, bigBlind: 2, buyIn: 100 }], preferences: prefs({ stakes: preferences.stakes }), decisions: [] })[0].components.stakes).toBe(0);
    const cash = candidate('cash', { bigBlind: null, distanceMiles: null, availableSeats: null, waitlistCount: null });
    expect(rankMatchCandidates({ candidates: [cash], preferences: prefs({ buyIn: preferences.buyIn }), decisions: [] })[0].score).toBe(0);
    expect(rankMatchCandidates({ candidates: [{ ...event, buyIn: 300 }], preferences: { ...preferences, strictBuyIn: true }, decisions: [] })).toEqual([]);
  });
  it('does not award missing facts or invent personalized explanations for cold-start players', () => {
    const unknown = candidate('unknown', { distanceMiles: null, bigBlind: null, variant: null, availableSeats: null, waitlistCount: null });
    const [result] = rankMatchCandidates({ candidates: [unknown], preferences: prefs(), decisions: [] });
    expect(result.score).toBe(0);
    expect(result.reasons).toEqual([]);
    expect(scoreMatchAvailability(candidate('forming', { status: 'forming', availableSeats: 9 }))).toBe(0);
    expect(scoreMatchAvailability(candidate('full', { availableSeats: 0, waitlistCount: 5 }))).toBeLessThan(scoreMatchAvailability(candidate('seat')));
  });
  it('honors exclusions and unknown-distance strict radius without automatically relaxing filters', () => {
    const items = [candidate('excluded'), candidate('unknown', { distanceMiles: null }), candidate('far', { distanceMiles: 51 }), candidate('near')];
    const options = { candidates: items, preferences: prefs({ excludedClubIds: ['club-excluded'], maxDistanceMiles: 50 }), decisions: [] };
    expect(rankMatchCandidates(options).map((item) => item.ref.gameId)).toEqual(['near']);
    expect(rankMatchCandidates({ ...options, preferences: prefs({ maxDistanceMiles: 1 }) })).toEqual([]);
  });
  it('rejects malformed and negative distance facts under a strict radius without emitting fictional mileage', () => {
    const invalid = [null, NaN, Infinity, -Infinity, -1].map((distanceMiles, index) => candidate(`invalid-${index}`, { distanceMiles }));
    expect(rankMatchCandidates({ candidates: invalid, preferences: prefs({ maxDistanceMiles: 50 }), decisions: [] })).toEqual([]);
    expect(rankMatchCandidates({ candidates: invalid, preferences: prefs(), decisions: [] }).every((item) => item.components.proximity === 0 && !item.reasons.some((reason) => reason.includes('miles')))).toBe(true);
    expect(rankMatchCandidates({ candidates: [candidate('valid')], preferences: prefs({ maxDistanceMiles: NaN }), decisions: [] })).toEqual([]);
  });
  it('uses published tournament days and daytime/evening hours in the explicit device zone with a deterministic UTC fallback', () => {
    const event = scheduled('event', '2026-10-13T01:00:00.000Z'); // Monday evening in Chicago; Tuesday early morning in UTC.
    const preferences = prefs({ preferredDays: [1], preferredTime: 'evening' });
    const run = (timeZone?: string) => rankMatchCandidates({ candidates: [event], preferences, decisions: [], timeZone })[0];
    expect(run('America/Chicago')).toMatchObject({ status: 'scheduled', availableSeats: null, score: 15, components: { availability: 1 } });
    expect(run('America/Chicago').reasons).toEqual(['Published start matches your preferred day and time (America/Chicago).']);
    expect(run().components.availability).toBe(0);
    expect(run('invalid-zone').score).toBe(run('UTC').score);
    expect(run('America/Chicago').reasons.join(' ')).not.toMatch(/live|seat/i);
  });
  it('scores selected schedule dimensions independently and never invents a schedule for cash games or ambiguous dates', () => {
    const event = scheduled('event', '2026-10-13T01:00:00.000Z');
    const run = (items: MatchCandidate[], preferences: MatchPreferences) => rankMatchCandidates({ candidates: items, preferences, decisions: [], timeZone: 'America/Chicago' });
    expect(run([event], prefs({ preferredDays: [2], preferredTime: 'evening' }))[0].components.availability).toBe(0.5);
    expect(run([event], prefs({ preferredDays: [1] }))[0].components.availability).toBe(1);
    expect(run([event], prefs())[0].components.availability).toBe(0);
    for (const startsAt of ['invalid', '2026-10-12T20:00:00']) {
      expect(run([scheduled('ambiguous', startsAt)], prefs({ preferredDays: [1], preferredTime: 'evening' }))[0]).toMatchObject({ score: 0, reasons: [] });
    }
    const cash = candidate('cash');
    expect(run([cash], prefs({ preferredDays: [1], preferredTime: 'evening' }))).toEqual(run([cash], prefs()));
  });
  it.each([
    ['2026-10-12T05:59:00Z', 'day', 0], ['2026-10-12T06:00:00Z', 'day', 1],
    ['2026-10-12T17:59:00Z', 'day', 1], ['2026-10-12T18:00:00Z', 'day', 0],
    ['2026-10-12T17:59:00Z', 'evening', 0], ['2026-10-12T18:00:00Z', 'evening', 1],
    ['2026-10-12T23:59:00Z', 'evening', 1], ['2026-10-13T00:00:00Z', 'evening', 0]
  ] as const)('uses explicit period boundaries for %s and %s', (startsAt, preferredTime, availability) => {
    expect(rankMatchCandidates({ candidates: [scheduled('event', startsAt)], preferences: prefs({ preferredTime }), decisions: [], timeZone: 'UTC' })[0].components.availability).toBe(availability);
  });
  it('limits exploration to five normalized points outside known favorites and saved venues, without inferring attendance or dislike', () => {
    const fresh = candidate('fresh', { distanceMiles: null, variant: null, bigBlind: null, availableSeats: null, waitlistCount: null });
    const knownSave = candidate('known-save');
    const pass = candidate('passed');
    const preferences = prefs({ favoriteClubIds: ['club-favorite'], exploreNewVenues: true });
    const run = (items: MatchCandidate[], decisions: MatchDecision[] = [], weights = {}) => rankMatchCandidates({ candidates: items, preferences, decisions, weights });
    expect(run([fresh])[0]).toMatchObject({ score: 5, components: { venue: 0.5 }, reasons: ['Outside your favorite and currently saved venues.'] });
    expect(rankMatchCandidates({ candidates: [fresh], preferences: prefs({ exploreNewVenues: true }), decisions: [] })[0].score).toBe(0);
    expect(run([fresh], [], { venue: 100, stakes: 0, variant: 0, proximity: 0, availability: 0 })[0].score).toBe(5);
    expect(run([fresh], [decision(knownSave)])[0].score).toBe(5);
    const sameSavedVenue = { ...fresh, ref: { ...fresh.ref, clubId: knownSave.ref.clubId } };
    expect(run([sameSavedVenue], [decision(knownSave)])[0].score).toBe(0);
    const samePassedVenue = { ...fresh, ref: { ...fresh.ref, clubId: pass.ref.clubId } };
    expect(run([samePassedVenue], [decision(pass, 'passed')])[0].score).toBe(5);
    expect(rankMatchCandidates({ candidates: [fresh], preferences: { ...preferences, excludedClubIds: [fresh.ref.clubId] }, decisions: [] })).toEqual([]);
  });
  it('keeps the rendered recommendation deck bounded at 100 for large eligible catalogs', () => {
    const items = Array.from({ length: 6000 }, (_, index) => candidate(`game-${String(index).padStart(4, '0')}`));
    const ranked = rankMatchCandidates({ candidates: items, preferences: prefs(), decisions: [] });
    expect(ranked).toHaveLength(100);
    expect(new Set(ranked.map((item) => matchReferenceKey(item.ref))).size).toBe(100);
    expect(rankMatchCandidates({ candidates: [...items].reverse(), preferences: prefs(), decisions: [] }).map((item) => item.ref)).toEqual(ranked.map((item) => item.ref));
  });
  it('enforces explicit strict variants, stakes, buy-in and availability constraints', () => {
    const items = [candidate('nlh'), candidate('plo', { variant: 'plo' }), candidate('high', { bigBlind: 10 }), candidate('unknown', { variant: null, bigBlind: null }), candidate('queue', { waitlistCount: 8 }), candidate('full', { availableSeats: 0 })];
    const strict = prefs({ variants: ['nlh'], stakes: { minBigBlind: 1, maxBigBlind: 5 }, strictVariants: true, strictStakes: true, maxWaitlist: 2, requireSeatsNow: true });
    expect(rankMatchCandidates({ candidates: items, preferences: strict, decisions: [] }).map((item) => item.ref.gameId)).toEqual(['nlh']);
    expect(rankMatchCandidates({ candidates: items, preferences: prefs({ willingToWait: false }), decisions: [] }).every((item) => item.availableSeats && item.waitlistCount === 0)).toBe(true);
    expect(rankMatchCandidates({ candidates: items, preferences: prefs({ buyIn: { min: 50, max: 100 }, strictBuyIn: true }), decisions: [] })).toEqual([]);
  });
  it('excludes reviewed and active-request cards without turning a pass into a venue exclusion', () => {
    const first = candidate('first');
    const sameVenue = candidate('second', { ref: { ...first.ref, gameId: 'second' } });
    const active = candidate('active', { activeRequest: true });
    expect(rankMatchCandidates({ candidates: [first, sameVenue, active], preferences: prefs(), decisions: [decision(first, 'passed')] }).map((item) => item.ref.gameId)).toEqual(['second']);
    expect(rankMatchCandidates({ candidates: [first], preferences: prefs(), decisions: [decision(first)] })).toEqual([]);
  });
  it('uses stable tie-breaking and bounded venue diversity only among eligible games', () => {
    const first = candidate('a');
    const repeated = candidate('b', { ref: { ...first.ref, gameId: 'b' } });
    const other = candidate('c');
    const items = [first, repeated, other];
    const run = (candidates: MatchCandidate[]) => rankMatchCandidates({ candidates, preferences: prefs(), decisions: [] }).map((item) => item.ref.gameId);
    expect(run(items)).toEqual(run([...items].reverse()));
    expect(run(items)).toEqual(['a', 'c', 'b']);
    expect(rankMatchCandidates({ candidates: items, preferences: prefs({ excludedClubIds: ['club-c'] }), decisions: [], limit: 1 })).toHaveLength(1);
    expect(() => rankMatchCandidates({ candidates: items, preferences: prefs(), decisions: [], weights: { stakes: -1 } })).toThrow(RangeError);
  });
});

describe('Saved Match games resolve against the full current catalog', () => {
  it('keeps active requests and saves accessible after ranking or preference changes', () => {
    const all = catalog();
    const active = all.find((item) => item.activeRequest);
    if (!active) throw new Error('Missing active fixture');
    const record = decision(active);
    expect(rankMatchCandidates({ candidates: all, preferences: prefs({ excludedClubIds: [active.ref.clubId] }), decisions: [record] }).some((item) => matchReferenceKey(item.ref) === matchReferenceKey(active.ref))).toBe(false);
    expect(resolveSavedMatchGames({ candidates: all, decisions: [record], catalogComplete: true })).toEqual([{ record, candidate: active, unavailableReason: null }]);
  });
  it('retains unavailable bookmarks and distinguishes absent partial data from a removed game', () => {
    const item = candidate('removed');
    const record = decision(item);
    expect(resolveSavedMatchGames({ candidates: [], decisions: [record], catalogComplete: false })[0].unavailableReason).toContain('has not loaded');
    expect(resolveSavedMatchGames({ candidates: [], decisions: [record], catalogComplete: true })[0].unavailableReason).toContain('no longer');
    expect(resolveSavedMatchGames({ candidates: [{ ...item, status: 'inactive' }], decisions: [record], catalogComplete: true })[0].unavailableReason).toContain('no active');
    expect(resolveSavedMatchGames({ candidates: [], decisions: [decision(item, 'passed')], catalogComplete: true })).toEqual([]);
  });
  it.each([
    { cash: true, tournament: false, legacy: true },
    { cash: false, tournament: true, legacy: false }
  ])('uses per-kind completion cash=$cash tournament=$tournament instead of the legacy $legacy fallback', ({ cash, tournament, legacy }) => {
    const cashGame = candidate('missing-cash');
    const event = scheduled('missing-event', '2030-10-15T01:00:00.000Z');
    const options = {
      candidates: [], decisions: [decision(cashGame), { ...decision(event), mutationId: 'saved-event' }],
      catalogComplete: legacy, catalogCompleteByKind: { cash, tournament }
    };
    const resolved = resolveSavedMatchGames(options);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].candidate).toBeNull();
    expect(resolved[1].candidate).toBeNull();
    expect(resolved[0].unavailableReason).toContain(cash ? 'no longer' : 'has not loaded');
    expect(resolved[1].unavailableReason).toContain(tournament ? 'no longer' : 'has not loaded');
  });

});
