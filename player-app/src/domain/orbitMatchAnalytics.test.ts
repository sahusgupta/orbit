import { describe, expect, it } from 'vitest';
import { applyMatchOperation, createMatchState, matchEventRetentionMs, maxMatchEvents } from '../../../apps/api/src/shared/orbitMatchState.cjs';
import { summarizeRetainedMatchHistory } from './orbitMatchAnalytics';
import type { MatchDecision, MatchEvent, MatchReference, MatchState } from './orbitMatchTypes';

const nowMs = Date.parse('2026-10-12T12:00:00Z');
const a: MatchReference = { clubId: 'venue-a', gameId: 'game-a', kind: 'cash' };
const b: MatchReference = { clubId: 'venue-b', gameId: 'game-b', kind: 'cash' };
const c: MatchReference = { clubId: 'venue-c', gameId: 'game-c', kind: 'cash' };
const at = (offset = 0) => new Date(nowMs - 1000 + offset).toISOString();
function event(id: string, kind: MatchEvent['kind'], ref?: MatchReference, extras: Partial<MatchEvent> = {}): MatchEvent {
  return { eventId: id, kind, at: at(), ...(ref ? { ref } : {}), ...extras };
}
const saved = (ref: MatchReference, mutationId: string): MatchDecision => ({ ref, mutationId, decision: 'saved', decidedAt: at(), summary: { venueName: 'Sensitive venue label', gameName: 'Sensitive game label' } });
const state = (events: MatchEvent[], decisions: MatchDecision[] = []): MatchState => ({ ...createMatchState(), events, decisions });
const summary = (value: MatchState) => summarizeRetainedMatchHistory(value, { nowMs });

describe('Honest retained Match history rates', () => {
  it('returns null rates with zero denominators and explicit sampling/window limits', () => {
    const result = summary(createMatchState());
    for (const metric of [result.saveShare, result.passShare, result.impressedCandidateDetailOpenRate, result.savedCandidateRevisitRate, result.currentSavedMutationWaitlistRate]) {
      expect(metric).toEqual({ numerator: 0, denominator: 0, rate: null });
    }
    expect(result.coverage).toMatchObject({ source: 'sampled retained controller history', retentionDays: 30, eventLimit: maxMatchEvents, retainedEvents: 0, inputAtEventCap: false });
    expect(result.limitations.join(' ')).toMatch(/not completely logged/);
    expect(result.limitations.join(' ')).toMatch(/not independently verified attendance/);
  });
  it('uses accepted save/pass action samples as the denominator while keeping undo separate', () => {
    let value = createMatchState();
    const mutationId = 'save-mutation-00000001';
    value = applyMatchOperation(value, { mutationId, type: 'decide', decision: 'saved', ref: a, summary: saved(a, mutationId).summary }, nowMs - 100);
    value = applyMatchOperation(value, { mutationId: 'undo-mutation-00000001', type: 'undo', targetMutationId: mutationId }, nowMs - 50);
    value = applyMatchOperation(value, { mutationId: 'pass-mutation-00000001', type: 'decide', decision: 'passed', ref: b, summary: saved(b, mutationId).summary }, nowMs);
    const result = summary(value);
    expect(result.decisionEvents).toEqual({ saved: 1, passed: 1, total: 2 });
    expect(result.saveShare).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.passShare.rate).toBe(0.5);
    expect(result.loggedSamples.undo).toBe(1);
    expect(result.currentSavedMutationWaitlistRate).toEqual({ numerator: 0, denominator: 0, rate: null });
  });
  it('counts candidate detail opens within unique prior impressions, deduplicates samples, and separates orphan events', () => {
    const detail = event('detail-a', 'details', a, { at: at(50) });
    const result = summary(state([
      event('impression-a', 'impression', a), event('repeat-a', 'impression', a), event('impression-b', 'impression', b),
      detail, { ...detail }, event('repeat-detail-a', 'details', a, { at: at(100) }),
      event('detail-b', 'details', b, { at: at(100) }), event('orphan-c', 'details', c),
      event('early-detail-b', 'details', b, { at: at(-100) }), event('no-ref', 'details')
    ]));
    expect(result.impressedCandidateDetailOpenRate).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(result.coverage.excludedEvents.duplicateIds).toBe(1);
    expect(result.orphanEvents).toMatchObject({ total: 3, missingReference: 1, detailsWithoutImpression: 2 });
  });
  it('uses unique retained save-event references for revisit rates, independent of current save count', () => {
    const result = summary(state([
      event('save-a-one', 'saved', a), event('save-a-two', 'saved', a), event('save-b', 'saved', b),
      event('revisit-a-one', 'saved-revisit', a, { at: at(100) }), event('revisit-a-two', 'saved-revisit', a, { at: at(150) }),
      event('orphan-c', 'saved-revisit', c), event('no-ref', 'saved-revisit')
    ]));
    expect(result.savedCandidateRevisitRate).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
    expect(result.orphanEvents).toMatchObject({ total: 2, missingReference: 1, revisitsWithoutRetainedSave: 1 });
    expect(result.currentSavedMutationWaitlistRate.rate).toBeNull();
  });
  it('credits only unique exact current saved mutations with retained save events and matching later response samples', () => {
    const value = state([
      event('save-a-old', 'saved', a), event('save-a-current', 'saved', a), event('save-b-current', 'saved', b), event('removed-save-c', 'saved', c),
      event('convert-a', 'waitlist-success', a, { saveMutationId: 'save-a-current', at: at(100) }),
      event('repeat-convert-a', 'waitlist-success', a, { saveMutationId: 'save-a-current', at: at(150) }),
      event('convert-b', 'waitlist-success', b, { saveMutationId: 'save-b-current', at: at(100) }),
      event('stale-convert-a', 'waitlist-success', a, { saveMutationId: 'save-a-old', at: at(100) }),
      event('wrong-ref', 'waitlist-success', c, { saveMutationId: 'save-a-current', at: at(100) }),
      event('removed-convert-c', 'waitlist-success', c, { saveMutationId: 'removed-save-c', at: at(100) }),
      event('no-mutation', 'waitlist-success', b), event('early-convert', 'waitlist-success', b, { saveMutationId: 'save-b-current', at: at(-100) })
    ], [saved(a, 'save-a-current'), saved(b, 'save-b-current')]);
    const result = summary(value);
    expect(result.currentSavedMutationWaitlistRate).toEqual({ numerator: 2, denominator: 2, rate: 1 });
    expect(result.orphanEvents.waitlistWithoutCurrentRetainedSave).toBe(5);
    expect(result.decisionEvents.saved).toBe(4);
    for (const metric of [result.saveShare, result.passShare, result.impressedCandidateDetailOpenRate, result.savedCandidateRevisitRate, result.currentSavedMutationWaitlistRate]) {
      expect(metric.numerator).toBeLessThanOrEqual(metric.denominator);
      if (metric.rate !== null) expect(metric.rate).toBeGreaterThanOrEqual(0);
      if (metric.rate !== null) expect(metric.rate).toBeLessThanOrEqual(1);
    }
  });
  it('reports a success from a later-undone save as an orphan rather than current-save conversion or attendance', () => {
    const mutationId = 'save-mutation-00000001';
    let value = applyMatchOperation(createMatchState(), { mutationId, type: 'decide', decision: 'saved', ref: a, summary: saved(a, mutationId).summary }, nowMs - 100);
    value = applyMatchOperation(value, { mutationId: 'convert-mutation-0001', type: 'event', event: { kind: 'waitlist-success', ref: a, saveMutationId: mutationId } }, nowMs - 50);
    value = applyMatchOperation(value, { mutationId: 'undo-mutation-00000001', type: 'undo', targetMutationId: mutationId }, nowMs);
    const result = summary(value);
    expect(result.saveShare.rate).toBe(1);
    expect(result.currentSavedMutationWaitlistRate.rate).toBeNull();
    expect(result.orphanEvents.waitlistWithoutCurrentRetainedSave).toBe(1);
    expect(result.loggedSamples.undo).toBe(1);
  });
  it('keeps aged saves outside the denominator when their decision persists but their save event has expired', () => {
    const result = summary(state([
      event('old-save', 'saved', a, { at: new Date(nowMs - matchEventRetentionMs - 1).toISOString() }),
      event('recent-response', 'waitlist-success', a, { saveMutationId: 'old-save' })
    ], [saved(a, 'old-save')]));
    expect(result.coverage.excludedEvents.expired).toBe(1);
    expect(result.currentSavedMutationWaitlistRate).toEqual({ numerator: 0, denominator: 0, rate: null });
    expect(result.orphanEvents.waitlistWithoutCurrentRetainedSave).toBe(1);
  });
  it('applies the authoritative thirty-day/200-entry bounds and reports unavailable or discarded context', () => {
    const result = summary(state([
      event('expired', 'opened', undefined, { at: new Date(nowMs - matchEventRetentionMs - 1).toISOString() }),
      event('future', 'opened', undefined, { at: new Date(nowMs + 1).toISOString() }), event('invalid', 'opened', undefined, { at: 'invalid' }),
      ...Array.from({ length: 205 }, (_, index) => event(`sample-${index}`, 'opened', undefined, { at: at(index) }))
    ]));
    expect(result.coverage).toMatchObject({ retainedEvents: 200, inputAtEventCap: true,
      excludedEvents: { expired: 1, future: 1, invalidTimestamp: 1, duplicateIds: 0, overCap: 5 } });
    expect(result.loggedSamples.opened).toBe(200);
    expect(summary(state([event('boundary', 'empty', undefined, { at: new Date(nowMs - matchEventRetentionMs).toISOString() }), event('failed', 'load-failed')])).loggedSamples).toMatchObject({ empty: 1, loadFailed: 1 });
  });
  it('does not mutate input or emit references, owner identity, coordinates, venue labels, or event/mutation identifiers', () => {
    const value = state([event('private-event-id', 'saved', a)], [saved(a, 'private-event-id')]);
    value.preferences.favoriteClubIds = ['secret-favorite'];
    Reflect.set(value, 'ownerEmail', 'person@example.test'); Reflect.set(value, 'origin', { latitude: 12.123456, longitude: -45.654321 });
    const before = JSON.stringify(value);
    const result = summary(value);
    expect(JSON.stringify(value)).toBe(before);
    const output = JSON.stringify(result);
    for (const privateValue of ['venue-a', 'game-a', 'private-event-id', 'Sensitive venue label', 'Sensitive game label', 'secret-favorite', 'person@example.test', '12.123456', '-45.654321']) {
      expect(output).not.toContain(privateValue);
    }
    expect(result).not.toHaveProperty('ref'); expect(result).not.toHaveProperty('decisions'); expect(result).not.toHaveProperty('events');
    expect(() => summarizeRetainedMatchHistory(value, { nowMs: NaN })).toThrow(RangeError);
  });
});
