import { describe, expect, it } from 'vitest';
import { adultDeclarationVersion, hasAdultDeclaration } from './playerOnboarding';

describe('Player onboarding age declaration', () => {
  it('requires a timestamped, versioned 18+ declaration', () => {
    expect(hasAdultDeclaration({})).toBe(false);
    expect(hasAdultDeclaration({ adultDeclaredAt: 'not-a-date', adultDeclarationVersion })).toBe(false);
    expect(hasAdultDeclaration({ adultDeclaredAt: '2026-09-04T12:00:00.000Z', adultDeclarationVersion })).toBe(true);
  });
});
