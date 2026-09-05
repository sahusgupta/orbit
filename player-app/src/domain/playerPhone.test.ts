import { describe, expect, it } from 'vitest';
import { normalizeE164Phone } from './playerPhone';

describe('Player phone normalization', () => {
  it('normalizes the prompted country-code form into canonical E.164', () => {
    expect(normalizeE164Phone('+1 555 555 0123')).toBe('+15555550123');
  });

  it('accepts international E.164 numbers without assuming a US country code', () => {
    expect(normalizeE164Phone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalizeE164Phone('+81-3-1234-5678')).toBe('+81312345678');
  });

  it('rejects numbers that omit the leading plus and country code', () => {
    expect(normalizeE164Phone('555 555 0123')).toBe('');
    expect(normalizeE164Phone('00 44 20 7946 0958')).toBe('');
  });
});
