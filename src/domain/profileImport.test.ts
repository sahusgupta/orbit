import { describe, expect, it } from 'vitest';
import { resolveGameId } from '../lib/appCore';
import {
  mergeImportedProfiles,
  parseCsvRows,
  parsePastedProfiles,
  profileFromImportedRecord,
  type ProfileImportContext
} from './profileImport';
import type { GameConfig, PlayerProfile, TableTag } from './types';

const games: GameConfig[] = [
  {
    id: 'nlh-1-2',
    name: '1/2 NLH',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  },
  {
    id: 'plo',
    name: 'Pot Limit Omaha',
    maxSeats: 8,
    minInRoomForLikely: 3,
    minFlexibleForLikely: 4,
    minTotalForViable: 6
  }
];

const validTableTags: TableTag[] = [
  'Action',
  'Social',
  'Competitive',
  'Beginner-Friendly',
  'Deep-Stacked',
  'Relaxed',
  'Short-handed',
  'Full-ring',
  'Fast-moving',
  'Slow-moving'
];

const createContext = (): ProfileImportContext => {
  let nextId = 0;
  return {
    games,
    createProfileId: () => `generated-${++nextId}`,
    todayDate: () => '2026-08-08',
    nextYearDate: () => '2027-08-08',
    resolveGameId,
    validTableTags
  };
};

const profile = (id: string, name: string, usualCompanions: string[] = []): PlayerProfile => ({
  id,
  name,
  phone: '',
  birthday: '',
  membershipStartDate: '2026-08-08',
  membershipExpirationDate: '2027-08-08',
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameId: 'nlh-1-2',
  preferredGameIds: ['nlh-1-2'],
  gamePlayCounts: {},
  mostPlayedGameId: 'nlh-1-2',
  preferredStakes: '1/2 NLH',
  typicalBuyInMin: 0,
  typicalBuyInMax: 0,
  willingnessToMove: true,
  typicalAvailability: '',
  preferredTags: [],
  usualCompanions,
  notes: ''
});

describe('profile import domain boundary', () => {
  it('parses quoted CSV cells and escaped quotes without losing header aliases', () => {
    expect(parseCsvRows([
      'Name,Phone,Notes',
      '"Alice, Jr.",555-0100,"Says ""hello"""'
    ].join('\n'))).toEqual([
      { Name: 'Alice, Jr.', Phone: '555-0100', Notes: 'Says "hello"' }
    ]);
  });

  it('normalizes spreadsheet aliases, dates, games, numbers, companions, and tags', () => {
    const context = createContext();
    expect(profileFromImportedRecord({
      'First Name': 'Dora',
      'Last Name': 'Lane',
      DOB: new Date('1991-02-03T00:00:00.000Z'),
      'Join Date': 1,
      'Expiration Date': 2,
      'Lifetime Hours': '7.5',
      Game: 'PLO',
      Companions: 'Bob|Carol',
      'Move Tables': 'yes',
      preferredTags: ['Action', 'Not A Tag', 42]
    }, context)).toEqual({
      id: 'generated-1',
      name: 'Dora Lane',
      phone: '',
      birthday: '1991-02-03',
      membershipStartDate: '1899-12-31',
      membershipExpirationDate: '1900-01-01',
      totalTimePlayedHours: 7.5,
      lastSessionTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: [],
      preferredGameId: 'plo',
      preferredGameIds: ['plo'],
      gamePlayCounts: {},
      mostPlayedGameId: 'plo',
      preferredStakes: 'PLO',
      typicalBuyInMin: 0,
      typicalBuyInMax: 0,
      willingnessToMove: true,
      typicalAvailability: '',
      preferredTags: ['Action'],
      usualCompanions: ['Bob', 'Carol'],
      notes: ''
    });
  });

  it('preserves JSON validation and malformed-JSON delimited fallback semantics', () => {
    const context = createContext();
    const jsonProfiles = parsePastedProfiles(JSON.stringify([
      null,
      { name: '' },
      {
        id: 'json-player',
        name: ' JSON Player ',
        preferredGameIds: ['PLO', 'missing'],
        gamePlayCounts: { PLO: '3', missing: 9 },
        totalTimePlayedHours: 'invalid',
        commonlyPlaysWithProfileIds: [null, 'known-profile'],
        preferredTags: ['Social', 'invalid']
      }
    ]), context);
    const fallbackProfiles = parsePastedProfiles('{Alice,unknown game,,,,Bob|Carol,Weekends,no', context);

    expect(jsonProfiles).toHaveLength(1);
    expect(jsonProfiles[0]).toMatchObject({
      id: 'json-player',
      name: 'JSON Player',
      preferredGameId: 'plo',
      preferredGameIds: ['plo'],
      gamePlayCounts: { plo: 3 },
      totalTimePlayedHours: 0,
      commonlyPlaysWithProfileIds: ['known-profile'],
      preferredTags: ['Social']
    });
    expect(fallbackProfiles).toHaveLength(1);
    expect(fallbackProfiles[0]).toMatchObject({
      name: '{Alice',
      preferredGameId: 'nlh-1-2',
      preferredStakes: 'unknown game',
      membershipStartDate: '2026-08-08',
      membershipExpirationDate: '2027-08-08',
      usualCompanions: ['Bob', 'Carol'],
      typicalAvailability: 'Weekends',
      willingnessToMove: false
    });
  });

  it('keeps existing names, preserves same-batch ordering, resolves companions, and does not mutate inputs', () => {
    const existing = [profile('bob', 'Bob')];
    const imported = [profile('alice', 'Alice', ['Bob']), profile('duplicate-bob', 'Bob')];
    const existingSnapshot = structuredClone(existing);
    const importedSnapshot = structuredClone(imported);

    const result = mergeImportedProfiles(existing, imported);

    expect(result.importedProfiles).toEqual([
      { ...imported[0], commonlyPlaysWithProfileIds: ['bob'] }
    ]);
    expect(result.profiles).toEqual([...existing, ...result.importedProfiles]);
    expect(existing).toEqual(existingSnapshot);
    expect(imported).toEqual(importedSnapshot);
  });
});
