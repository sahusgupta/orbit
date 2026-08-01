export interface SeatNormalizationSession {
  tableId: string;
  seatNumber?: number;
  leftAt?: string;
}

export function normalizePlayerSessionSeats<T extends SeatNormalizationSession>(
  sessions: T[],
  getMaxSeats: (session: T) => number
): Array<T & { seatNumber: number }> {
  const occupiedActiveSeatsByTable = new Map<string, Set<number>>();

  return sessions.map((session) => {
    const maxSeats = Math.max(1, Math.floor(getMaxSeats(session)));
    const requestedSeat = Number(session.seatNumber);
    const hasValidSeat =
      Number.isInteger(requestedSeat) &&
      requestedSeat >= 1 &&
      requestedSeat <= maxSeats;

    // Completed sessions are historical records, not current seat reservations.
    // Preserve their valid seat so reopening or upgrading the app cannot displace
    // players who are currently seated at the same table.
    if (session.leftAt) {
      return {
        ...session,
        seatNumber: hasValidSeat ? requestedSeat : Math.min(maxSeats, Math.max(1, requestedSeat || 1))
      };
    }

    const occupiedSeats = occupiedActiveSeatsByTable.get(session.tableId) ?? new Set<number>();
    const seatNumber =
      hasValidSeat && !occupiedSeats.has(requestedSeat)
        ? requestedSeat
        : Array.from({ length: maxSeats }, (_, index) => index + 1).find((seat) => !occupiedSeats.has(seat)) ?? maxSeats;

    occupiedSeats.add(seatNumber);
    occupiedActiveSeatsByTable.set(session.tableId, occupiedSeats);

    return { ...session, seatNumber };
  });
}
