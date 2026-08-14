import { describe, expect, it } from 'vitest';
import legacyState from './db/legacyState.js';

const { mapLegacyStateDocument } = legacyState;

function makeState(accountKey) {
  return {
    games: [{ id: 'holdem', name: '1/2 NLH' }],
    sessions: [],
    playerSessions: [],
    profiles: [{ id: 'player-1', name: 'Regular Player' }],
    settings: {
      clubAccount: { clubName: 'Lucky Lodge' },
      pilotAccess: { licenseId: accountKey, issuedTo: 'Lucky Lodge' }
    }
  };
}

describe('legacy Firebase state recovery', () => {
  it('accepts a valid full-state document only when its state belongs to the exact license account', () => {
    expect(mapLegacyStateDocument('Legacy Lucky Lodge', {
      savedAt: '2026-08-05T21:00:00.000Z',
      state: makeState('legacy-lucky-lodge')
    })).toMatchObject({
      accountKey: 'legacy-lucky-lodge',
      venueName: 'Lucky Lodge',
      savedAt: '2026-08-05T21:00:00.000Z',
      source: 'legacy-firebase',
      state: { games: [{ id: 'holdem', name: '1/2 NLH' }] }
    });

    expect(mapLegacyStateDocument('legacy-lucky-lodge', {
      state: makeState('different-account')
    })).toBeNull();
    expect(mapLegacyStateDocument('legacy-lucky-lodge', {
      deprecated: true,
      savedAt: '2026-08-06T21:00:00.000Z'
    })).toBeNull();
  });
});
