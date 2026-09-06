import { describe, expect, it } from 'vitest';
import { decodePersistedAppState, normalizeState, seedState } from './state';

describe('state normalization', () => {
  it('preserves immutable player references on normalized table audit events', () => {
    const tableEvent = {
      id: 'event-player-bearing',
      type: 'Started' as const,
      gameId: 'game-one',
      tableId: 'table-one',
      timestamp: '2026-09-01T00:00:00.000Z',
      playerCount: 2,
      note: 'Started with two players',
      profileId: 'profile-one',
      profileIds: ['profile-one', 'profile-two']
    };

    const decoded = decodePersistedAppState({ tableEvents: [tableEvent] });
    expect(decoded?.tableEvents).toEqual([tableEvent]);
    expect(normalizeState(decoded ?? {}).tableEvents).toEqual([
      { ...tableEvent, reason: '' }
    ]);
  });

  it('does not seed membership products or publish legacy plans without explicit activation', () => {
    expect(seedState.settings.membershipPlans).toEqual([]);
    expect(normalizeState({}).settings.membershipPlans).toEqual([]);

    const legacyPlan = {
      id: 'legacy-monthly',
      name: 'Legacy Monthly',
      priceLabel: '$40',
      durationDays: 30
    } as unknown as (typeof seedState.settings.membershipPlans)[number];
    const malformedPlan = {
      id: 'malformed',
      name: 'Malformed',
      priceLabel: '$0',
      durationDays: ''
    } as unknown as (typeof seedState.settings.membershipPlans)[number];
    const restored = normalizeState({ settings: { membershipPlans: [legacyPlan, malformedPlan] } });

    expect(restored.settings.membershipPlans).toEqual([
      { ...legacyPlan, active: false },
      { ...malformedPlan, durationDays: 0, active: false }
    ]);
  });

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

  it('does not restore an active operator without a live trusted staff session', () => {
    const restored = normalizeState({
      settings: {
        activeStaffId: 'manager-one',
        staffAccounts: [{
          id: 'manager-one',
          name: 'Manager One',
          role: 'Manager',
          pinSalt: 'salt',
          pinHash: 'hash',
          active: true,
          createdAt: '2026-08-25T12:00:00.000Z'
        }]
      }
    });

    expect(restored.settings.staffAccounts).toHaveLength(1);
    expect(restored.settings.activeStaffId).toBeUndefined();
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

  it('defaults persisted saved-time credits and preserves existing nonnegative balances', () => {
    const profile = {
      id: 'profile-time-credit',
      name: 'Time Credit Player',
      phone: '',
      birthday: '',
      membershipStartDate: '2026-01-01',
      membershipExpirationDate: '2027-01-01',
      totalTimePlayedHours: 0,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'time-game',
      preferredGameIds: ['time-game'],
      gamePlayCounts: {},
      mostPlayedGameId: 'time-game',
      preferredStakes: '',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      willingnessToMove: false,
      typicalAvailability: '',
      usualCompanions: [],
      preferredTags: [],
      notes: ''
    };
    const playerSession = {
      id: 'session-time-credit',
      playerName: profile.name,
      profileId: profile.id,
      gameId: 'time-game',
      tableId: 'table-time-credit',
      seatedAt: '2026-08-28T12:00:00.000Z'
    };

    const defaults = normalizeState({ ...structuredClone(seedState), profiles: [profile], playerSessions: [playerSession] });
    const preserved = normalizeState({
      ...structuredClone(seedState),
      profiles: [{ ...profile, savedTimeCreditMinutes: 75 }],
      playerSessions: [{ ...playerSession, timeCreditAppliedMinutes: 30 }]
    });
    const ocrIdentity = normalizeState({
      ...structuredClone(seedState),
      profiles: [{ ...profile, identityCaptureMethod: 'id-image-ocr' as const }]
    });
    const imageBarcodeIdentity = normalizeState({
      ...structuredClone(seedState),
      profiles: [{ ...profile, identityCaptureMethod: 'id-image-pdf417' as const }]
    });

    expect(defaults.profiles[0].savedTimeCreditMinutes).toBe(0);
    expect(defaults.playerSessions[0].timeCreditAppliedMinutes).toBe(0);
    expect(preserved.profiles[0].savedTimeCreditMinutes).toBe(75);
    expect(preserved.playerSessions[0].timeCreditAppliedMinutes).toBe(30);
    expect(ocrIdentity.profiles[0].identityReviewStatus).toBe('Pending');
    expect(imageBarcodeIdentity.profiles[0].identityReviewStatus).toBe('Pending');
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
