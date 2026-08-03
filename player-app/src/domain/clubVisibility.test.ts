import { describe, expect, it } from 'vitest';
import { isPlayerVisibleClubName, isPlayerVisibleGameName } from './clubVisibility';

describe('player club visibility', () => {
  it('keeps named demo clubs and hides stress-test clubs', () => {
    expect(isPlayerVisibleClubName('Orbit Demo Club')).toBe(true);
    expect(isPlayerVisibleClubName('Test Club')).toBe(false);
    expect(isPlayerVisibleClubName('  test club  ')).toBe(false);
    expect(isPlayerVisibleClubName('Test Clubhouse')).toBe(true);
    expect(isPlayerVisibleClubName('Stress Test Club 14')).toBe(false);
    expect(isPlayerVisibleClubName('LOAD-STRESS-HOUSTON')).toBe(false);
  });

  it('hides unnamed club records instead of showing placeholder content', () => {
    expect(isPlayerVisibleClubName('')).toBe(false);
    expect(isPlayerVisibleClubName(undefined)).toBe(false);
  });

  it('hides unnamed and stress-generated game records', () => {
    expect(isPlayerVisibleGameName('1/2 NLH')).toBe(true);
    expect(isPlayerVisibleGameName('Stress Game 42')).toBe(false);
    expect(isPlayerVisibleGameName('')).toBe(false);
  });
});
