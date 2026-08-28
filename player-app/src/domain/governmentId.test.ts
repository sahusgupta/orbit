import { describe, expect, it } from 'vitest';
import { calculatePlayerAge, normalizeIdDate, parseGovernmentIdBarcode } from './governmentId';

describe('player government ID barcode parsing', () => {
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

  it('extracts only the profile-safe AAMVA fields and calculates age', () => {
    const result = parseGovernmentIdBarcode(raw, new Date(2026, 7, 27));
    expect(result).toEqual({
      fullName: 'JANE QUINN DOE',
      dateOfBirth: '1990-01-02',
      address: '100 MAIN STREET, AUSTIN, TX 787010000, USA',
      age: 36
    });
    expect(JSON.stringify(result)).not.toContain('D12345678');
    expect(JSON.stringify(result)).not.toContain('@ANSI');
  });

  it('supports year-first dates and observes the birthday boundary', () => {
    expect(normalizeIdDate('19901231')).toBe('1990-12-31');
    expect(calculatePlayerAge('2005-08-28', new Date(2026, 7, 27))).toBe(20);
    expect(calculatePlayerAge('2005-08-27', new Date(2026, 7, 27))).toBe(21);
  });

  it('rejects malformed, incomplete, and impossible records', () => {
    expect(normalizeIdDate('02312000')).toBe('');
    expect(parseGovernmentIdBarcode('not an id')).toBeNull();
    expect(parseGovernmentIdBarcode('DCSDOE\nDACJANE\nDBB01021990')).toBeNull();
  });

  it('does not treat field-code letters inside an address as another field', () => {
    expect(parseGovernmentIdBarcode(raw.replace('100 MAIN STREET', '123 DAKOTA STREET'))?.address)
      .toBe('123 DAKOTA STREET, AUSTIN, TX 787010000, USA');
  });
});
