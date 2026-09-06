import type { PlayerSyncGame } from '@/src/domain/types';
import { formatEventDate } from '@/src/domain/selectors';
import { StatusBadge } from '@/src/components/ui/status-badge';

export function PublishedGameTables({ tables }: { tables: PlayerSyncGame['openTables'] }) {
  if (!tables.length) {
    return (
      <div className="notice-box">
        <strong>No published tables</strong>
        <p>Table status, seats, and waitlist availability are unavailable until the venue publishes a table through Orbit Core.</p>
      </div>
    );
  }

  return (
    <div className="table-list">
      {tables.map((table) => {
        const running = table.status === 'Running';
        const availability = running
          ? String(table.availableSeats)
          : table.status === 'Paused' ? 'Paused' : 'Not open yet';
        return (
          <article key={table.id}>
            <div>
              <StatusBadge tone={running ? 'live' : table.status === 'Forming' ? 'forming' : 'warning'}>{table.status}</StatusBadge>
              <h3>{table.label}</h3>
              <p>{running ? `Started ${formatEventDate(table.startedAt)}` : `Venue reports this table as ${table.status.toLowerCase()}.`}</p>
            </div>
            <dl>
              <div><dt>{running ? 'Reported seats' : 'Capacity'}</dt><dd>{running ? `${table.seatsFilled}/${table.maxSeats}` : 'Unavailable for this status'}</dd></div>
              <div><dt>{running ? 'Available seats' : 'Availability'}</dt><dd>{availability}</dd></div>
              <div><dt>Collection</dt><dd>{table.collectionMode}</dd></div>
            </dl>
          </article>
        );
      })}
    </div>
  );
}
