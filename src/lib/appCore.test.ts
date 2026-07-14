import { describe, expect, it } from 'vitest';
import {
  canonicalPayload,
  countActivePlayersForTable,
  createBackupEnvelope,
  getGameFrequencyRank,
  getProfilesWithGameInTopTwoByFrequency,
  getTimerStatusFromMinutes,
  getTimerStatusFromSeconds,
  readBackupEnvelope,
  resolveGameId
} from './appCore';

describe('timer status thresholds', () => {
  it('uses green above or at 20 minutes, yellow below 20, and red below 5', () => {
    expect(getTimerStatusFromMinutes(21)).toBe('green');
    expect(getTimerStatusFromMinutes(20)).toBe('green');
    expect(getTimerStatusFromMinutes(19)).toBe('yellow');
    expect(getTimerStatusFromMinutes(5)).toBe('yellow');
    expect(getTimerStatusFromMinutes(4)).toBe('red');
    expect(getTimerStatusFromMinutes(0)).toBe('red');
  });

  it('matches the seconds-based table card thresholds', () => {
    expect(getTimerStatusFromSeconds(20 * 60)).toBe('green');
    expect(getTimerStatusFromSeconds(19 * 60 + 59)).toBe('yellow');
    expect(getTimerStatusFromSeconds(5 * 60)).toBe('yellow');
    expect(getTimerStatusFromSeconds(5 * 60 - 1)).toBe('red');
  });
});

describe('license canonical payloads', () => {
  it('sorts keys before signing or verification', () => {
    expect(canonicalPayload({ expiresAt: '2026-08-01', authorizationCode: 'abc' })).toBe(
      '{"authorizationCode":"abc","expiresAt":"2026-08-01"}'
    );
  });
});

describe('backup envelopes', () => {
  it('wraps app state in a versioned backup envelope', () => {
    const envelope = createBackupEnvelope({ games: [], sessions: [], settings: {} }, '2026-05-15T12:00:00.000Z');
    expect(envelope).toEqual({
      app: 'TableManager',
      kind: 'full-state-backup',
      version: 1,
      exportedAt: '2026-05-15T12:00:00.000Z',
      state: { games: [], sessions: [], settings: {} }
    });
  });

  it('accepts both new envelopes and old raw state exports', () => {
    const envelope = readBackupEnvelope({ app: 'TableManager', kind: 'full-state-backup', version: 1, exportedAt: 'x', state: { ok: true } });
    const legacy = readBackupEnvelope({ games: [], sessions: [], settings: {} });

    expect(envelope.state).toEqual({ ok: true });
    expect(legacy.state).toEqual({ games: [], sessions: [], settings: {} });
  });

  it('rejects unrelated JSON', () => {
    expect(() => readBackupEnvelope({ hello: 'world' })).toThrow(/Orbit backup/);
  });
});

describe('table seat counts', () => {
  it('counts only active players at the requested table', () => {
    expect(
      countActivePlayersForTable(
        [
          { tableId: 'a' },
          { tableId: 'a', leftAt: '2026-05-15T12:00:00.000Z' },
          { tableId: 'b' },
          { tableId: 'a' }
        ],
        'a'
      )
    ).toBe(2);
  });
});

describe('game id lookup', () => {
  const games = [
    { id: '1-2-nlh', name: '1/2 NLH' },
    { id: 'plo-1-2', name: '1/2 PLO' }
  ];

  it('accepts saved game ids and typed game names', () => {
    expect(resolveGameId(games, '1-2-nlh')).toBe('1-2-nlh');
    expect(resolveGameId(games, '1/2 NLH')).toBe('1-2-nlh');
    expect(resolveGameId(games, 'NLH 1/2')).toBe('1-2-nlh');
  });

  it('falls back when the saved value cannot be matched', () => {
    expect(resolveGameId(games, 'mystery game', '1-2-nlh')).toBe('1-2-nlh');
  });
});

describe('game frequency outreach targeting', () => {
  it('selects only players whose target game is ranked first or second by frequency and have a phone', () => {
    const profiles = [
      { id: 'top', phone: '555-0100', gamePlayCounts: { nlh: 12, plo: 3 } },
      { id: 'second', phone: '555-0101', gamePlayCounts: { plo: 12, nlh: 8, lhe: 2 } },
      { id: 'third', phone: '555-0102', gamePlayCounts: { plo: 12, lhe: 8, nlh: 2 } },
      { id: 'no-phone', phone: '', gamePlayCounts: { nlh: 9 } }
    ];

    expect(getProfilesWithGameInTopTwoByFrequency(profiles, 'nlh').map((profile) => profile.id)).toEqual(['top', 'second']);
  });

  it('returns null when a player has no positive frequency for the game', () => {
    expect(getGameFrequencyRank({ nlh: 0, plo: 3 }, 'nlh')).toBeNull();
  });
});
