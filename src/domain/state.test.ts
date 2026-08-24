import { describe, expect, it } from 'vitest';
import { normalizeState } from './state';

describe('state normalization', () => {
  it('restores permanent table identities and keeps game-session bindings separate', () => {
    const restored = normalizeState({
      games: [{
        id: 'holdem',
        name: '$1/$2 Holdem',
        maxSeats: 10,
        minInRoomForLikely: 4,
        minFlexibleForLikely: 2,
        minTotalForViable: 6
      }],
      physicalTables: [{
        id: 'physical-1',
        label: ' Table 1 ',
        maxSeats: 8,
        createdAt: '2026-08-18T12:00:00.000Z'
      }],
      sessions: [{
        id: 'session-1',
        physicalTableId: 'physical-1',
        gameId: 'holdem',
        label: 'Table 1',
        status: 'Running',
        seatsFilled: 0,
        maxSeats: 8,
        tags: [],
        startedAt: '2026-08-18T18:00:00.000Z'
      }]
    });

    expect(restored.physicalTables).toEqual([{
      id: 'physical-1',
      label: 'Table 1',
      maxSeats: 8,
      createdAt: '2026-08-18T12:00:00.000Z'
    }]);
    expect(restored.sessions[0]).toMatchObject({
      id: 'session-1',
      physicalTableId: 'physical-1',
      maxSeats: 8
    });
  });

  it('migrates legacy state without permanent tables to an empty collection', () => {
    expect(normalizeState({ games: [], sessions: [] }).physicalTables).toEqual([]);
  });

  it('migrates legacy per-game time fees to one flat room rate', () => {
    const restored = normalizeState({
      settings: {
        collectionProfiles: [
          { gameId: 'drop-game', collectionMode: 'Drop', hourlyFee: 4, estimatedDropPerSeatHour: 8 },
          { gameId: 'time-game', collectionMode: 'Time', hourlyFee: 13, estimatedDropPerSeatHour: 0 },
          { gameId: 'other-time-game', collectionMode: 'Time', hourlyFee: 20, estimatedDropPerSeatHour: 0 }
        ]
      }
    });

    expect(restored.settings.defaultHourlyFee).toBe(13);
    expect(restored.settings.collectionProfiles.map((profile) => profile.hourlyFee)).toEqual([13, 13, 13]);
  });

  it('keeps an explicitly configured room rate authoritative over legacy profile values', () => {
    const restored = normalizeState({
      settings: {
        defaultHourlyFee: 15,
        collectionProfiles: [
          { gameId: 'time-game', collectionMode: 'Time', hourlyFee: 99, estimatedDropPerSeatHour: 0 }
        ]
      }
    });

    expect(restored.settings.defaultHourlyFee).toBe(15);
    expect(restored.settings.collectionProfiles[0].hourlyFee).toBe(15);
  });

  it('preserves bounded self-check-in configuration and durable assistance status', () => {
    const restored = normalizeState({
      staffRequests: [
        {
          id: 'pending-one',
          type: 'self-check-in-assistance',
          playerName: 'New Player',
          reason: 'not-found',
          status: 'pending',
          createdAt: '2026-08-24T12:00:00.000Z'
        },
        {
          id: 'handled-one',
          type: 'self-check-in-assistance',
          playerName: 'Handled Player',
          reason: 'ambiguous',
          status: 'handled',
          createdAt: '2026-08-24T12:01:00.000Z',
          handledAt: '2026-08-24T12:02:00.000Z',
          handledByStaffId: 'manager-one'
        }
      ],
      selfCheckIn: {
        capabilityGeneration: 'generation-one',
        generatedAt: '2026-08-24T11:59:00.000Z'
      }
    });

    expect(restored.staffRequests).toEqual([
      expect.objectContaining({ id: 'pending-one', status: 'pending' }),
      expect.objectContaining({
        id: 'handled-one',
        status: 'handled',
        handledAt: '2026-08-24T12:02:00.000Z',
        handledByStaffId: 'manager-one'
      })
    ]);
    expect(restored.selfCheckIn).toEqual({
      capabilityGeneration: 'generation-one',
      generatedAt: '2026-08-24T11:59:00.000Z'
    });
  });
});
