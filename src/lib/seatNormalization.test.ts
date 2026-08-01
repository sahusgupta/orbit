import { describe, expect, it } from 'vitest';
import { normalizePlayerSessionSeats } from './seatNormalization';

describe('player session seat normalization', () => {
  it('does not let completed player history displace currently seated players', () => {
    const sessions = [
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `past-${index + 1}`,
        tableId: 'main-table',
        seatNumber: index + 1,
        leftAt: '2026-07-30T23:00:00.000Z'
      })),
      { id: 'active-2', tableId: 'main-table', seatNumber: 2 },
      { id: 'active-7', tableId: 'main-table', seatNumber: 7 }
    ];

    const normalized = normalizePlayerSessionSeats(sessions, () => 10);

    expect(normalized.find((session) => session.id === 'active-2')?.seatNumber).toBe(2);
    expect(normalized.find((session) => session.id === 'active-7')?.seatNumber).toBe(7);
  });

  it('repairs duplicate seats only among currently seated players', () => {
    const sessions = [
      { id: 'first', tableId: 'main-table', seatNumber: 4 },
      { id: 'duplicate', tableId: 'main-table', seatNumber: 4 },
      { id: 'other-table', tableId: 'side-table', seatNumber: 4 }
    ];

    const normalized = normalizePlayerSessionSeats(sessions, () => 10);

    expect(normalized.map((session) => session.seatNumber)).toEqual([4, 1, 4]);
  });
});
