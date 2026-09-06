import { describe, expect, it } from 'vitest';
import { normalizePublishedGames } from './orbitSyncApi';

const gameDoc = (id: string, data: unknown) => ({ id, data: () => data });

const publishedGame = (overrides: Record<string, unknown> = {}) => ({
  id: 'nlh-1-2',
  name: '1/2 NLH',
  maxSeats: 10,
  collectionMode: 'Time',
  openTables: [],
  waitlistCount: 0,
  formingCount: 0,
  availableSeats: 0,
  knownPlayersCount: 0,
  updatedAt: '2026-08-09T12:00:00.000Z',
  syncRevision: 'revision-2',
  ...overrides
});

describe('published game normalization', () => {
  it('preserves explicit zero values and strips unreviewed fields', () => {
    expect(normalizePublishedGames([
      gameDoc('document-id', publishedGame({ id: '', injected: 'discard' }))
    ])).toEqual([{
      id: 'document-id',
      name: '1/2 NLH',
      maxSeats: 10,
      collectionMode: 'Time',
      openTables: [],
      waitlistCount: 0,
      formingCount: 0,
      availableSeats: 0,
      knownPlayersCount: 0,
      updatedAt: '2026-08-09T12:00:00.000Z',
      syncRevision: 'revision-2'
    }]);
  });

  it.each([
    ['null record', null],
    ['missing counters', { id: 'game', name: 'Game', openTables: [] }],
    ['null capacity', publishedGame({ maxSeats: null })],
    ['empty capacity', publishedGame({ maxSeats: '' })],
    ['string counter', publishedGame({ waitlistCount: '0' })],
    ['out-of-range availability', publishedGame({ availableSeats: 11 })]
  ])('filters a malformed %s instead of inventing published facts', (_label, value) => {
    expect(normalizePublishedGames([gameDoc('bad', value)])).toEqual([]);
  });

  it('omits a malformed optional game mode instead of replacing it with a product fact', () => {
    expect(normalizePublishedGames([gameDoc('game', publishedGame({ collectionMode: 'Unknown' }))])[0])
      .not.toHaveProperty('collectionMode');
  });

  it('filters partial legacy sessions that lack a complete published game projection', () => {
    expect(normalizePublishedGames([gameDoc('session', {
      gameId: 'nlh-1-2',
      gameName: '1/2 NLH',
      status: 'Running',
      label: '',
      format: 'Unknown',
      updatedAt: ''
    })])).toEqual([]);
  });
});
