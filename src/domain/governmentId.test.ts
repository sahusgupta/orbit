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

  it('supports Canadian-style year-first dates and complete magnetic-stripe reads', () => {
    expect(normalizeIdDate('19901231')).toBe('1990-12-31');
    const raw = [
      '%TXAUSTIN^DOE$JOHN$JR^12 RIVER RD?',
      ';636000123456789=280119901231=?'
    ].join('\n');

    expect(parseGovernmentIdScan(raw, new Date(2026, 0, 1))).toEqual({
      fullName: 'JOHN DOE JR',
      dateOfBirth: '1990-12-31',
      address: '12 RIVER RD, AUSTIN, TX',
      age: 35
    });
  });

  it('supports fixed-width magnetic-stripe fields when maximum-length separators are omitted', () => {
    const exactCity = parseGovernmentIdScan([
      '%TXABCDEFGHIJKLMDOE$JOHN^12 RIVER RD?',
      ';636000123456789=280119901231=?'
    ].join('\n'), new Date(2026, 0, 1));
    const exactNameValue = `DOE$${'J'.repeat(31)}`;
    const exactName = parseGovernmentIdScan([
      `%TXAUSTIN^${exactNameValue}12 RIVER RD?`,
      ';636000123456789=280119901231=?'
    ].join('\n'), new Date(2026, 0, 1));

    expect(exactCity?.address).toBe('12 RIVER RD, ABCDEFGHIJKLM, TX');
    expect(exactName?.address).toBe('12 RIVER RD, AUSTIN, TX');
    expect(exactName?.dateOfBirth).toBe('1990-12-31');
  });

  it('does not treat field-code letters inside an address as another field', () => {
    const raw = [
      'DCSDOE',
      'DACJANE',
      'DBB01021990',
      'DAG123 DAKOTA STREET',
      'DAIAUSTIN',
      'DAJTX',
      'DAK787010000',
      'DCGUSA'
    ].join('\n');

    expect(parseGovernmentIdScan(raw, new Date(2026, 7, 27))?.address)
      .toBe('123 DAKOTA STREET, AUSTIN, TX 787010000, USA');
  });

  it('keeps an optional second PDF417 street-address line', () => {
    const raw = [
      'DCSDOE',
      'DACJANE',
      'DBB01021990',
      'DAG100 MAIN STREET',
      'DAHAPT 4B',
      'DAIAUSTIN',
      'DAJTX',
      'DAK787010000',
      'DCGUSA'
    ].join('\n');

    expect(parseGovernmentIdScan(raw, new Date(2026, 7, 27))?.address)
      .toBe('100 MAIN STREET, APT 4B, AUSTIN, TX 787010000, USA');
  });

  it('uses the birthday boundary and rejects malformed data', () => {
    expect(calculatePlayerAge('2005-08-28', new Date(2026, 7, 27))).toBe(20);
    expect(calculatePlayerAge('2005-08-27', new Date(2026, 7, 27))).toBe(21);
    expect(normalizeIdDate('02312000')).toBe('');
    expect(parseGovernmentIdScan('not an id')).toBeNull();
  });
});
