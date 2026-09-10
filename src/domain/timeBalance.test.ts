import { describe, expect, it } from 'vitest';
import { getExactTimeRemainingMinutes, getTimeRemainingSeconds } from './operations';
import type { PlayerSession } from './types';

const now = Date.parse('2026-09-10T00:00:00.000Z');
const player: PlayerSession = {
  id: 'player', playerName: 'Test', tableId: 'table', gameId: 'game',
  seatedAt: new Date(now).toISOString(), timeFeeEnabled: true, timeRemainingMinutes: 30
};
describe('precise time balances', () => {
  it('retains milliseconds in mutations and renders whole seconds', () => {
    expect(getExactTimeRemainingMinutes(player, now + 45_500)).toBeCloseTo(29 + 14.5 / 60);
    expect(getTimeRemainingSeconds(player, now + 45_500)).toBe(1755);
    expect(getTimeRemainingSeconds({ ...player, timeRemainingMinutes: 29 + 14.5 / 60 }, now)).toBe(1755);
  });
  it('never adds a phantom second when the render clock predates the action', () => {
    expect(getTimeRemainingSeconds(player, now - 500)).toBe(1800);
  });
  it('stops expired and paused timers', () => {
    expect(getTimeRemainingSeconds(player, now + 31 * 60_000)).toBe(0);
    expect(getTimeRemainingSeconds({ ...player, timeFeeEnabled: false }, now)).toBe(0);
  });
});
