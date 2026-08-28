import { getProjectedTimeFeeEntries } from '../../domain/reporting';
import type { AppState, GameSession } from '../../domain/types';

type TableBuyInLedgerProps = {
  state: AppState;
  session: GameSession;
  formatClock: (iso?: string) => string;
};

export default function TableBuyInLedger({ state, session, formatClock }: TableBuyInLedgerProps) {
  // Keep the raw event rows intact: each reload/add-on is its own ledger entry,
  // even when several entries belong to the same player.
  const buyIns = state.buyIns
    .filter((entry) => entry.tableId === session.id)
    .map((entry, recordedOrder) => ({ ...entry, recordedOrder }));
  const cashOuts = state.playerLedger.filter((entry) => entry.tableId === session.id && entry.type === 'Cash-Out');
  const drops = state.dropLogs.filter((entry) => entry.tableId === session.id);
  const timeFees = (session.collectionMode === 'Time' || session.timeFeeBased)
    ? getProjectedTimeFeeEntries(state)
        .filter((entry) => entry.tableId === session.id)
        .map((entry) => ({
          id: entry.id,
          playerName: entry.playerName,
          amount: entry.amount,
          timestamp: entry.timestamp,
          note: `${entry.minutes} minutes purchased${entry.source === 'legacy' ? ' (legacy estimate)' : ''}`
        }))
    : [];
  const totalBuyIns = buyIns.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCashOuts = cashOuts.reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const totalDrop = drops.reduce((sum, entry) => sum + entry.amount, 0);
  const totalTimeFees = timeFees.reduce((sum, entry) => sum + entry.amount, 0);
  const totalHouseRevenue = totalDrop + totalTimeFees;
  const cashInPlay = totalBuyIns - totalCashOuts - totalDrop;
  const unrecordedCashOutCount = cashOuts.filter((entry) => entry.amount === undefined).length;
  const entries = [
    ...buyIns.map((entry) => ({ ...entry, kind: 'Buy-in', direction: 'in' as const })),
    ...cashOuts.map((entry) => ({ ...entry, kind: 'Cash-out', direction: 'out' as const })),
    ...drops.map((entry) => ({ ...entry, playerName: 'House collection', kind: 'Drop', direction: 'fee' as const })),
    ...timeFees.map((entry) => ({ ...entry, kind: 'Time fee', direction: 'in' as const }))
  ].sort((left, right) => {
    const timestampOrder = right.timestamp.localeCompare(left.timestamp);
    if (timestampOrder !== 0) return timestampOrder;
    return ('recordedOrder' in left ? left.recordedOrder : Number.MAX_SAFE_INTEGER)
      - ('recordedOrder' in right ? right.recordedOrder : Number.MAX_SAFE_INTEGER);
  });

  return (
    <section className="cash-ledger">
      <div className="cash-ledger-summary">
        <article><span>Total buy-ins</span><strong>${totalBuyIns.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article><span>Cash-outs</span><strong>${totalCashOuts.toLocaleString(undefined, { maximumFractionDigits: 2 })}{unrecordedCashOutCount ? ` + ${unrecordedCashOutCount} not recorded` : ''}</strong></article>
        <article><span>House revenue</span><strong>${totalHouseRevenue.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
        <article className="cash-ledger-balance"><span>Cash in play</span><strong>{unrecordedCashOutCount ? 'Incomplete' : `$${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong></article>
      </div>
      <div className="cash-ledger-reconcile">
        <span>Reconciliation</span>
        <code>{unrecordedCashOutCount
          ? `${unrecordedCashOutCount} cash-out amount${unrecordedCashOutCount === 1 ? '' : 's'} not recorded; cash in play cannot be reconciled.`
          : `$${totalBuyIns.toLocaleString()} − $${totalCashOuts.toLocaleString()} − $${totalDrop.toLocaleString(undefined, { maximumFractionDigits: 2 })} drop = $${cashInPlay.toLocaleString(undefined, { maximumFractionDigits: 2 })} in play; +$${totalTimeFees.toLocaleString(undefined, { maximumFractionDigits: 2 })} time paid separately`}</code>
      </div>
      <div className="cash-ledger-log">
        {entries.length ? entries.map((entry) => (
          <article className={`cash-ledger-entry ${entry.direction}`} key={`${entry.kind}-${entry.id}`}>
            <div className="cash-ledger-marker" />
            <time dateTime={entry.timestamp}>{formatClock(entry.timestamp)}</time>
            <div className="cash-ledger-entry-copy">
              <strong>{entry.kind}</strong>
              <span>{entry.playerName}{entry.note ? ` · ${entry.note}` : ''}</span>
            </div>
            <em>{entry.amount === undefined
              ? 'Not recorded'
              : `${entry.direction === 'in' ? '+' : '−'}$${entry.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</em>
          </article>
        )) : <div className="cash-ledger-empty"><strong>No transactions yet</strong><span>Buy-ins, cash-outs, drop, and time fees will appear here.</span></div>}
      </div>
    </section>
  );
}
