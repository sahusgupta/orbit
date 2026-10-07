export const accountKey = 'mutation-smoke';
export const testKey = 'local-mutation-smoke-only';
export const createMutationState = () => {
  const now = new Date().toISOString();
  return {
    games: [{ id: 'smoke-game', name: 'Mutation game', maxSeats: 8, minInRoomForLikely: 2, minFlexibleForLikely: 2, minTotalForViable: 4 }],
    physicalTables: [{ id: 'physical-smoke', label: 'Mutation table', maxSeats: 8, createdAt: now }],
    profiles: [{ id: 'smoke-profile', name: 'Synthetic Player', birthday: '', membershipStartDate: '', membershipExpirationDate: '', totalTimePlayedHours: 0, lastSessionTimePlayedHours: 0, commonlyPlaysWithProfileIds: [], preferredGameId: 'smoke-game', preferredGameIds: ['smoke-game'], preferredStakes: '', typicalBuyInMin: 0, typicalBuyInMax: 0, willingnessToMove: true, typicalAvailability: '', usualCompanions: [], preferredTags: [], notes: '' }],
    interests: [{ id: 'smoke-interest', profileId: 'smoke-profile', playerName: 'Synthetic Player', gameId: 'smoke-game', status: 'Arrived', timestamp: now, notes: '' }],
    sessions: [{ id: 'smoke-table', physicalTableId: 'physical-smoke', label: 'Mutation table', gameId: 'smoke-game', status: 'Running', seatsFilled: 0, maxSeats: 8, timeFeeBased: true, collectionMode: 'Time', tags: [], startedAt: now }],
    playerSessions: [], buyIns: [], timeFeeLogs: [], dropLogs: [], playerLedger: [], tableEvents: [], correctionLog: [], usageEvents: [], history: [], inAppNotifications: [], feedback: [], scriptTemplates: [], tournaments: [], revenueTransactions: [], dealerAssignments: [], handCountLogs: [],
    settings: { lowLight: false, showPlayerGrid: true, defaultCollectionMode: 'Time', defaultHourlyFee: 20, defaultEstimatedDropPerSeatHour: 0, defaultTableCap: 8,
      collectionProfiles: [{ gameId: 'smoke-game', collectionMode: 'Time', hourlyFee: 20, estimatedDropPerSeatHour: 0 }],
      pilotAccess: { authorized: true, authorizationCode: testKey, licenseId: accountKey, issuedTo: 'Synthetic Room', expiresAt: '2099-12-31', activatedAt: now },
      clubAccount: { clubName: 'Synthetic Room', accountName: 'Synthetic Account', contactName: 'QA', email: 'qa@example.test', phone: '', address: '' },
      accountLogin: { username: 'synthetic', passwordSalt: 'unused-fixture', passwordHash: 'unused-fixture', createdAt: now }, staffAccounts: [] }
  };
};
