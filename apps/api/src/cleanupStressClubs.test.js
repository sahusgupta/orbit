import { describe, expect, it } from 'vitest';
import cleanup from './cleanupStressClubs.js';

const { isStressClubName, selectStressClubs } = cleanup;

function clubDocument(id, name) {
  return {
    id,
    data: () => ({ name })
  };
}

describe('stress club cleanup guard', () => {
  it('matches stress in a club name without case sensitivity', () => {
    expect(isStressClubName('Stress Test Club 12')).toBe(true);
    expect(isStressClubName('LOAD-STRESS-HOUSTON')).toBe(true);
    expect(isStressClubName('Orbit Demo Club')).toBe(false);
  });

  it('selects only named stress clubs and keeps normal clubs out of scope', () => {
    const matches = selectStressClubs([
      clubDocument('normal', 'Orbit Demo Club'),
      clubDocument('stress-b', 'Stress Test B'),
      clubDocument('missing-name', ''),
      clubDocument('stress-a', 'stress test A')
    ]);

    expect(matches).toEqual([
      { id: 'stress-a', name: 'stress test A' },
      { id: 'stress-b', name: 'Stress Test B' }
    ]);
  });
});
