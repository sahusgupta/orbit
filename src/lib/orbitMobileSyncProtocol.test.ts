import { describe, expect, it } from 'vitest';
import {
  orbitSyncProtocolVersion,
  hasUncommittedFutureRevision,
  selectCommittedGames,
  selectRevisionCompatibleRecords
} from '../../player-app/src/domain/syncProtocol';

describe('Orbit desktop-to-mobile sync protocol', () => {
  it('keeps legacy publishers compatible', () => {
    const games = [{ id: 'game-1' }, { id: 'game-2' }];
    expect(selectCommittedGames({}, games)).toEqual(games);
  });

  it('does not promote a partial desktop revision', () => {
    const commit = {
      syncProtocolVersion: orbitSyncProtocolVersion,
      syncRevision: 'revision-2',
      entityCounts: { games: 2 }
    };
    const games = [
      { id: 'game-1', syncRevision: 'revision-2' },
      { id: 'game-2', syncRevision: 'revision-1' }
    ];

    expect(selectCommittedGames(commit, games)).toBeNull();
  });

  it('does not expose staged v2 children before a legacy parent is promoted', () => {
    expect(selectCommittedGames({}, [{
      id: 'game-1',
      syncRevision: 'revision-2'
    }])).toBeNull();

    expect(hasUncommittedFutureRevision({}, [{
      id: 'membership-1',
      syncRevision: 'revision-2'
    }])).toBe(true);
  });

  it('promotes only the complete committed game revision', () => {
    const commit = {
      syncProtocolVersion: orbitSyncProtocolVersion,
      syncRevision: 'revision-2',
      entityCounts: { games: 2 }
    };
    const games = [
      { id: 'game-1', syncRevision: 'revision-2' },
      { id: 'game-2', syncRevision: 'revision-2' },
      { id: 'removed-game', syncRevision: 'revision-1' }
    ];

    expect(selectCommittedGames(commit, games)).toEqual(games.slice(0, 2));
  });

  it('keeps server-managed records while removing stale desktop records', () => {
    const commit = {
      syncProtocolVersion: orbitSyncProtocolVersion,
      syncRevision: 'revision-2'
    };
    const records = [
      { id: 'current', syncRevision: 'revision-2' },
      { id: 'stale', syncRevision: 'revision-1' },
      { id: 'payment-service-membership' }
    ];

    expect(selectRevisionCompatibleRecords(commit, records)).toEqual([
      records[0],
      records[2]
    ]);
  });

  it('holds the previous snapshot when child records are newer than the parent commit', () => {
    const commit = {
      syncProtocolVersion: orbitSyncProtocolVersion,
      syncRevision: 'revision-1',
      publishedAt: '2026-07-25T00:00:00.000Z'
    };

    expect(hasUncommittedFutureRevision(commit, [{
      id: 'membership-1',
      syncRevision: 'revision-2',
      publishedAt: '2026-07-25T00:00:01.000Z'
    }])).toBe(true);

    expect(hasUncommittedFutureRevision(commit, [{
      id: 'removed-membership',
      syncRevision: 'revision-0',
      publishedAt: '2026-07-24T23:59:59.000Z'
    }])).toBe(false);
  });
});
