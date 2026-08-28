import { describe, expect, it } from 'vitest';
import { calculatePlayerAge, normalizeIdDate, parseGovernmentIdScan } from './governmentId';

describe('government ID scan parsing', () => {
  it('extracts only profile-safe AAMVA fields and calculates age', () => {
    const raw = [
      '@ANSI 636000080002DL00410288ZA03290015DL',
      'DAQD12345678',
      'DCSDOE',
      'DACJANE',
      'DADQUINN',
      'DBB01021990',
      'DAG100 MAIN STREET',
      'DAIAUSTIN',
      'DAJTX',
      'DAK787010000',
      'DCGUSA'
    ].join('\n');

    expect(parseGovernmentIdScan(raw, new Date(2026, 7, 27))).toEqual({
      fullName: 'JANE QUINN DOE',
      dateOfBirth: '1990-01-02',
      address: '100 MAIN STREET, AUSTIN, TX 787010000, USA',
      age: 36
    });
  });

  it('supports Canadian-style year-first dates and magnetic-stripe names', () => {
    expect(normalizeIdDate('19901231')).toBe('1990-12-31');
    expect(parseGovernmentIdScan('%TXAUSTIN^DOE$JOHN$Q^12 RIVER RD?', new Date(2026, 0, 1))).toMatchObject({
      fullName: 'JOHN Q DOE',
      address: '12 RIVER RD'
    });
  });

  it('uses the birthday boundary and rejects malformed data', () => {
    expect(calculatePlayerAge('2005-08-28', new Date(2026, 7, 27))).toBe(20);
    expect(calculatePlayerAge('2005-08-27', new Date(2026, 7, 27))).toBe(21);
    expect(normalizeIdDate('02312000')).toBe('');
    expect(parseGovernmentIdScan('not an id')).toBeNull();
  });
});
