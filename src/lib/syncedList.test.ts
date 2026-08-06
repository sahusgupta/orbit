import { describe, expect, expectTypeOf, it } from 'vitest';
import { mergeSyncedList } from './syncedList';

type SyncedItem = {
  marker: string;
  id?: string;
  name?: string;
  playerName?: string;
};

describe('synchronized list merging', () => {
  it('uses id before the name fallbacks and replaces local items in place', () => {
    const latest: SyncedItem[] = [
      { id: 'profile-1', name: 'Shared Name', marker: 'local-first' },
      { id: 'profile-2', name: 'Shared Name', marker: 'local-second' }
    ];
    const synced: SyncedItem[] = [
      { id: 'profile-2', name: 'Different Name', marker: 'synced-second' },
      { id: 'profile-1', name: 'Different Name', marker: 'synced-first' }
    ];

    const merged = mergeSyncedList(latest, synced);

    expectTypeOf(merged).toEqualTypeOf<SyncedItem[]>();
    expect(merged.map((item) => item.marker)).toEqual(['synced-first', 'synced-second']);
  });

  it('falls back to normalized names and then normalized player names', () => {
    const latest: SyncedItem[] = [
      { name: '  Alice  ', marker: 'local-name' },
      { playerName: '  BOB  ', marker: 'local-player-name' }
    ];
    const synced: SyncedItem[] = [
      { name: 'alice', marker: 'synced-name' },
      { playerName: 'bob', marker: 'synced-player-name' }
    ];

    expect(mergeSyncedList(latest, synced).map((item) => item.marker)).toEqual([
      'synced-name',
      'synced-player-name'
    ]);
  });

  it('uses the last synced duplicate to replace every matching local item', () => {
    const latest: SyncedItem[] = [
      { id: 'duplicate', marker: 'local-first' },
      { id: 'duplicate', marker: 'local-second' }
    ];
    const synced: SyncedItem[] = [
      { id: 'duplicate', marker: 'synced-first' },
      { id: 'duplicate', marker: 'synced-last' }
    ];

    expect(mergeSyncedList(latest, synced).map((item) => item.marker)).toEqual([
      'synced-last',
      'synced-last'
    ]);
  });

  it('preserves local ordering and appends unmatched synced items in synced order', () => {
    const latest: SyncedItem[] = [
      { id: 'local-1', marker: 'local-first' },
      { id: 'shared', marker: 'local-shared' },
      { id: 'local-2', marker: 'local-last' }
    ];
    const synced: SyncedItem[] = [
      { id: 'remote-1', marker: 'remote-first' },
      { id: 'shared', marker: 'synced-shared' },
      { id: 'remote-2', marker: 'remote-last' }
    ];

    expect(mergeSyncedList(latest, synced).map((item) => item.marker)).toEqual([
      'local-first',
      'synced-shared',
      'local-last',
      'remote-first',
      'remote-last'
    ]);
  });

  it('preserves local items with empty keys and ignores synced items with empty keys', () => {
    const latest: SyncedItem[] = [
      { marker: 'local-missing' },
      { name: '   ', playerName: '   ', marker: 'local-empty' }
    ];
    const synced: SyncedItem[] = [
      { marker: 'synced-missing' },
      { name: '   ', playerName: '   ', marker: 'synced-empty' }
    ];

    expect(mergeSyncedList(latest, synced)).toEqual(latest);
  });

  it('keeps unmatched synced duplicates instead of deduplicating appended items', () => {
    const synced: SyncedItem[] = [
      { id: 'remote-duplicate', marker: 'remote-first' },
      { id: 'remote-duplicate', marker: 'remote-second' }
    ];

    expect(mergeSyncedList([], synced)).toEqual(synced);
  });
});
