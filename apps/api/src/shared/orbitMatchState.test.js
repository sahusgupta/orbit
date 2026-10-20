import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(resolve(process.cwd(), 'apps/api/src/shared/orbitMatchState.test.js'));
const { applyMatchOperation, createMatchState, decodeMatchOperation, decodeMatchState, matchEventRetentionMs, pruneMatchState } = require('./orbitMatchState.cjs');
const now = Date.parse('2026-10-12T12:00:00Z');
/** @type {import('../../../../player-app/src/domain/orbitMatchTypes').MatchReference} */
const ref = { clubId: 'club-one', gameId: 'game-one', kind: 'cash' };
/** @param {string} suffix @param {Partial<Extract<import('../../../../player-app/src/domain/orbitMatchTypes').MatchOperation, {type: 'decide'}>>} [overrides]
 * @returns {Extract<import('../../../../player-app/src/domain/orbitMatchTypes').MatchOperation, {type: 'decide'}>} */
const decide = (suffix, overrides = {}) => ({ mutationId: `match-mutation-${suffix}`, type: 'decide', ref,
  summary: { venueName: 'Published Club', gameName: '1/2 NLH' }, decision: 'saved', ...overrides });

describe('Orbit Match public state and operation boundary', () => {
  it('returns owned public data without internal receipts, identity, or precise location fields', () => {
    const state = createMatchState();
    expect(decodeMatchState({ ...state, receipts: ['private'], playerEmail: 'private@example.test', coordinate: { latitude: 1, longitude: 2 } })).toEqual(state);
    expect(decodeMatchOperation({ ...decide('one'), playerId: 'other-player' })).toBeNull();
    expect(decodeMatchOperation({ ...decide('one'), ref: { ...ref, gameId: '../private' } })).toBeNull();
    expect(decodeMatchOperation({ ...decide('one'), summary: { venueName: 'A'.repeat(201), gameName: 'NLH' } })).toBeNull();
    expect(decodeMatchState({ ...state, revision: -1 })).toBeNull();
    expect(decodeMatchState({ ...state, decisions: [{ ...decide('one'), decidedAt: 'invalid' }] })).toBeNull();
  });

  it('bounds all preference values and rejects unrecognized or duplicate choices', () => {
    const state = createMatchState();
    const operation = { mutationId: 'match-preferences-one', type: 'preferences', basePreferencesRevision: 0, preferences: state.preferences };
    expect(decodeMatchOperation(operation)).toEqual(operation);
    for (const patch of [{ variants: ['unknown'] }, { variants: ['nlh', 'nlh'] }, { preferredDays: [7] },
      { stakes: { minBigBlind: 10, maxBigBlind: 2 } }, { buyIn: { min: 0, max: Infinity } },
      { maxDistanceMiles: 501 }, { maxWaitlist: 0.5 }, { favoriteClubIds: Array.from({ length: 101 }, (_, i) => `club-${i}`) },
      { strictVariants: 'true' }, { preciseLocation: { latitude: 0, longitude: 0 } }]) {
      expect(decodeMatchOperation({ ...operation, preferences: { ...state.preferences, ...patch } })).toBeNull();
    }
  });

  it('saves references without joining waitlists and makes optimistic replay idempotent', () => {
    const source = createMatchState();
    const next = applyMatchOperation(source, decide('one'), now);
    expect(source.decisions).toEqual([]);
    expect(next.decisions).toHaveLength(1);
    expect(next.decisions[0]).toMatchObject({ ref, decision: 'saved', mutationId: 'match-mutation-one' });
    expect(next).not.toHaveProperty('waitlists');
    expect(next.revision).toBe(1);
    expect(next.recentMutationIds).toEqual(['match-mutation-one']);
    expect(applyMatchOperation(next, decide('one'), now + 1000)).toEqual(next);
  });

  it('protects newer decisions from stale removal or undo and restores the actual prior value', () => {
    const first = applyMatchOperation(createMatchState(), decide('one'), now);
    const second = applyMatchOperation(first, decide('two', { decision: 'passed' }), now + 1000);
    expect(() => applyMatchOperation(second, { mutationId: 'match-remove-stale', type: 'remove', ref, expectedDecisionMutationId: 'match-mutation-one' }, now))
      .toThrow('changed on another device');
    expect(() => applyMatchOperation(second, { mutationId: 'match-undo-stale-1', type: 'undo', targetMutationId: 'match-mutation-one' }, now))
      .toThrow('cannot be undone');
    const undone = applyMatchOperation(second, { mutationId: 'match-undo-latest-1', type: 'undo', targetMutationId: 'match-mutation-two' }, now + 2000);
    expect(undone.decisions).toEqual(first.decisions);
    expect(undone.undo).toBeNull();
    expect(undone.events.at(-1)).toMatchObject({ kind: 'undo', ref });
  });

  it('uses preference revision compare-and-swap while preserving saved games', () => {
    const state = applyMatchOperation(createMatchState(), decide('one'), now);
    const updated = applyMatchOperation(state, { mutationId: 'match-preferences-one', type: 'preferences', basePreferencesRevision: 0,
      preferences: { ...state.preferences, variants: ['plo'], strictVariants: true } }, now);
    expect(updated.preferencesRevision).toBe(1);
    expect(updated.decisions).toEqual(state.decisions);
    expect(() => applyMatchOperation(updated, { mutationId: 'match-preferences-two', type: 'preferences', basePreferencesRevision: 0,
      preferences: state.preferences }, now)).toThrow('preferences changed');
  });

  it('retains every save while pruning passes and minimal event history by age and count', () => {
    let state = createMatchState();
    state = applyMatchOperation(state, decide('ancient', { ref: { ...ref, gameId: 'saved-old' } }), now - 2 * matchEventRetentionMs);
    for (let index = 0; index < 305; index += 1) {
      state = applyMatchOperation(state, decide(`pass-${index}`, { ref: { ...ref, gameId: `passed-${index}` }, decision: 'passed' }), now + index);
    }
    expect(state.decisions.filter((item) => item.decision === 'passed')).toHaveLength(300);
    expect(state.decisions.filter((item) => item.decision === 'saved')).toHaveLength(1);
    expect(state.events).toHaveLength(200);
    const later = pruneMatchState(state, now + 2 * matchEventRetentionMs);
    expect(later.decisions.map((item) => item.ref.gameId)).toEqual(['saved-old']);
    expect(later.events).toEqual([]);
    expect(later.undo).toBeNull();
  });

  it('does not record a claimed saved-game conversion against another saved decision', () => {
    const state = applyMatchOperation(createMatchState(), decide('one'), now);
    /** @type {Extract<import('../../../../player-app/src/domain/orbitMatchTypes').MatchOperation, {type: 'event'}>} */
    const event = { mutationId: 'match-conversion-one', type: 'event', event: { kind: 'waitlist-success', ref, saveMutationId: 'match-mutation-other' } };
    expect(() => applyMatchOperation(state, event, now)).toThrow('no longer current');
    expect(applyMatchOperation(state, { ...event, event: { ...event.event, saveMutationId: 'match-mutation-one' } }, now).events.at(-1))
      .toMatchObject({ kind: 'waitlist-success', ref, saveMutationId: 'match-mutation-one' });
  });
});
