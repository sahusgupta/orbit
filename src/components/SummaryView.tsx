import type { Dispatch, SetStateAction } from 'react';
import { Download, LockKeyhole, Save, Target, X } from 'lucide-react';
import PanelTitle from './PanelTitle';
import { hoursBetween } from '../domain/operations';
import {
  shiftReportAnchor,
  type getDealerReport,
  type getReportFinancials,
  type getReportHourlyBreakdown,
  type getReportWindow
} from '../domain/reporting';
import { todayDate } from '../domain/state';
import type { getAnalytics, getOperationalOpportunities, getUsageAnalytics } from '../domain/analytics';
import type { NightCloseTable } from '../lib/nightClose';
import type { AppState, NightCloseRecord, ReportPeriod, TableEvent } from '../domain/types';
import type { KpiCategory, ReportMode } from '../features/reporting/reportingWorkspace';

type SummaryViewProps = {
  state: AppState;
  reportAnalytics: ReturnType<typeof getAnalytics>;
  reportState: AppState;
  reportFinancials: ReturnType<typeof getReportFinancials>;
  reportHourlyBreakdown: ReturnType<typeof getReportHourlyBreakdown>;
  reportDealerBreakdown: ReturnType<typeof getDealerReport>;
  reportOpportunities: ReturnType<typeof getOperationalOpportunities>;
  reportWindow: ReturnType<typeof getReportWindow>;
  usageAnalytics: ReturnType<typeof getUsageAnalytics>;
  reportMode: ReportMode;
  reportPeriod: ReportPeriod;
  reportIsCurrentPeriod: boolean;
  kpiCategory: KpiCategory;
  currentNightClose: NightCloseRecord | undefined;
  effectiveNightCloseActuals: Record<string, string>;
  nightCloseTables: NightCloseTable[];
  nightCloseWarnings: string[];
  nightCloseTotals: { buyIns: number; cashOuts: number; removed: number; expected: number; actual: number; discrepancy: number };
  nightCloseHasMissingActual: boolean;
  nightCloseTotalProfit: number;
  nightCloseFinancials: ReturnType<typeof getReportFinancials>;
  nightCloseNotes: string;
  summaryNotes: string;
  exportCsv: () => void;
  closeRoute: () => void;
  formatClock: (iso?: string) => string;
  onOpenStaffSettings: () => void;
  onToggleLowLight: () => void;
  reopenNightClose: () => void;
  saveNightClose: () => unknown;
  signNightClose: () => void;
  approveAndLockNightClose: () => void;
  selectActiveStaff: (staffId: string) => void;
  setKpiCategory: Dispatch<SetStateAction<KpiCategory>>;
  setNightCloseActuals: Dispatch<SetStateAction<Record<string, string>>>;
  setNightCloseNotes: Dispatch<SetStateAction<string>>;
  setReportAnchorDate: Dispatch<SetStateAction<string>>;
  setReportMode: Dispatch<SetStateAction<ReportMode>>;
  setReportPeriod: Dispatch<SetStateAction<ReportPeriod>>;
  setSummaryNotes: Dispatch<SetStateAction<string>>;
  toLocalDateValue: (date: Date) => string;
};

export default function SummaryView({
  state,
  reportAnalytics,
  reportState,
  reportFinancials,
  reportHourlyBreakdown,
  reportDealerBreakdown,
  reportOpportunities,
  reportWindow,
  usageAnalytics,
  reportMode,
  reportPeriod,
  reportIsCurrentPeriod,
  kpiCategory,
  currentNightClose,
  effectiveNightCloseActuals,
  nightCloseTables,
  nightCloseWarnings,
  nightCloseTotals,
  nightCloseHasMissingActual,
  nightCloseTotalProfit,
  nightCloseFinancials,
  nightCloseNotes,
  summaryNotes,
  exportCsv,
  closeRoute,
  formatClock,
  onOpenStaffSettings,
  onToggleLowLight,
  reopenNightClose,
  saveNightClose,
  signNightClose,
  approveAndLockNightClose,
  selectActiveStaff,
  setKpiCategory,
  setNightCloseActuals,
  setNightCloseNotes,
  setReportAnchorDate,
  setReportMode,
  setReportPeriod,
  setSummaryNotes,
  toLocalDateValue
}: SummaryViewProps) {
    const analytics = reportAnalytics;
    const gamesStartedInPeriod = reportState.sessions.filter((session) => session.status !== 'Failed to Start').length;
    const totalTableHours = reportState.sessions.reduce((sum, session) => sum + hoursBetween(session.startedAt, session.endedAt), 0);
    const totalTrackedHands = reportState.handCountLogs.reduce((sum, entry) => sum + entry.hands, 0);
    const collectionPerTableHour = totalTableHours > 0 ? reportFinancials.totalProfit / totalTableHours : 0;
    const handsPerTableHour = totalTableHours > 0 ? totalTrackedHands / totalTableHours : 0;
    const dropPerSeatHour = analytics.currentNight.occupiedSeatHours > 0 ? reportFinancials.recordedDrop / analytics.currentNight.occupiedSeatHours : 0;
    const topEarningHour = reportHourlyBreakdown.reduce<(typeof reportHourlyBreakdown)[number] | null>(
      (best, item) => !best || item.total > best.total ? item : best,
      null
    );
    const hourLabel = (startMs: number) => {
      const start = new Date(startMs);
      const end = new Date(startMs + 36e5);
      const showDate = reportPeriod !== 'day';
      return `${showDate ? `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ` : ''}${start.toLocaleTimeString([], { hour: 'numeric' })}–${end.toLocaleTimeString([], { hour: 'numeric' })}`;
    };
  return (
      <main className={`app-shell compact-shell reports-page reports-mode-${reportMode} reports-kpi-${kpiCategory}`}>
        <header className="topbar">
          <div>
            <h1>Reports</h1>
            <p className="page-subtitle">{reportWindow.label} performance and closeout</p>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={exportCsv}>
              <Download size={18} />
              CSV
            </button>
            <button className="ghost-button" onClick={() => window.print()}>
              <Download size={18} />
              Screenshot / Print
            </button>
            <button className="ghost-button" onClick={closeRoute}>
              <X size={18} />
              Close
            </button>
            <button
              className="ghost-button"
              onClick={onToggleLowLight}
            >
              {state.settings.lowLight ? 'Day Mode' : 'Low Light'}
            </button>
          </div>
        </header>

        <nav className="report-mode-switch" aria-label="Report view">
          <button className={reportMode === 'kpis' ? 'active' : ''} onClick={() => setReportMode('kpis')}>KPIs & statistics</button>
          <button className={reportMode === 'night' ? 'active' : ''} onClick={() => setReportMode('night')}>Tonight's report</button>
          <button className={reportMode === 'close' ? 'active' : ''} onClick={() => setReportMode('close')}>Night close</button>
        </nav>
        <section className="report-period-toolbar" aria-label="Report date range">
          <nav className="report-period-tabs" aria-label="Group reports by">
            {([
              ['day', 'Tonight'],
              ['week', 'Week'],
              ['month', 'Month'],
              ['year', 'Year'],
              ['all', 'All time']
            ] as [ReportPeriod, string][]).map(([period, label]) => (
              <button
                key={period}
                className={reportPeriod === period ? 'active' : ''}
                onClick={() => setReportPeriod(period)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="report-period-navigation">
            <button
              className="ghost-button"
              disabled={reportPeriod === 'all'}
              onClick={() => setReportAnchorDate((current) => shiftReportAnchor(current, reportPeriod, -1))}
            >
              Previous
            </button>
            <strong>{reportWindow.label}</strong>
            <button
              className="ghost-button"
              disabled={reportIsCurrentPeriod}
              onClick={() => setReportAnchorDate((current) => shiftReportAnchor(current, reportPeriod, 1))}
            >
              Next
            </button>
            <button className="ghost-button" onClick={() => setReportAnchorDate(toLocalDateValue(new Date()))}>Today</button>
          </div>
        </section>

        <section className="report-profit-banner" aria-live="polite">
          <div className="report-profit-total">
            <span>Total profit · {reportWindow.label}</span>
            <strong>${reportFinancials.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <small>Recorded drop, time fees, memberships, and tournament payments before expenses</small>
          </div>
          <div className="report-profit-breakdown">
            <article>
              <span>Recorded drop</span>
              <strong>${reportFinancials.recordedDrop.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Time fees</span>
              <strong>${reportFinancials.timeFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Memberships</span>
              <strong>${reportFinancials.membershipRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
            <article>
              <span>Tournaments</span>
              <strong>${reportFinancials.tournamentRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </article>
          </div>
        </section>
        <section className="report-numerical-grid" aria-label="Detailed report numbers">
          <article><span>Collection / table-hour</span><strong>${collectionPerTableHour.toFixed(2)}</strong></article>
          <article><span>Drop / occupied seat-hour</span><strong>${dropPerSeatHour.toFixed(2)}</strong></article>
          <article><span>Hands logged</span><strong>{totalTrackedHands.toLocaleString()}</strong></article>
          <article><span>Hands / table-hour</span><strong>{handsPerTableHour.toFixed(1)}</strong></article>
          <article><span>Table-hours</span><strong>{totalTableHours.toFixed(1)}</strong></article>
          <article><span>Best earning hour</span><strong>{topEarningHour ? `$${topEarningHour.total.toFixed(0)}` : '$0'}</strong><small>{topEarningHour ? hourLabel(topEarningHour.startMs) : 'No collections logged'}</small></article>
        </section>
        {reportMode === 'kpis' ? <nav className="metric-category-menu" aria-label="Metric categories"><button className={kpiCategory === 'operations' ? 'active' : ''} onClick={() => setKpiCategory('operations')}>Operations</button><button className={kpiCategory === 'waitlist' ? 'active' : ''} onClick={() => setKpiCategory('waitlist')}>Waitlist</button><button className={kpiCategory === 'tables' ? 'active' : ''} onClick={() => setKpiCategory('tables')}>Tables</button><button className={kpiCategory === 'collections' ? 'active' : ''} onClick={() => setKpiCategory('collections')}>Collections</button></nav> : null}

        {reportMode === 'close' ? <section className="night-close-workspace">
          <header className="night-close-header">
            <div>
              <span className={`night-close-status status-${(currentNightClose?.status ?? 'Draft').toLowerCase().replace(/\s+/g, '-')}`}>{currentNightClose?.status ?? 'Draft'}</span>
              <h2>Reconcile {todayDate()}</h2>
              <p>Count each table, review exceptions, then complete staff and manager sign-off.</p>
            </div>
            <div className="night-close-header-actions">
              <button className="ghost-button" onClick={() => window.print()}><Download size={17} /> Print / PDF</button>
              {currentNightClose?.status === 'Locked' ? <button className="ghost-button danger" onClick={reopenNightClose}>Reopen with audit</button> : null}
            </div>
          </header>

          <div className="night-close-totals">
            <article><span>Total buy-ins</span><strong>${nightCloseTotals.buyIns.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Cash-outs</span><strong>${nightCloseTotals.cashOuts.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Drop + time</span><strong>${nightCloseTotals.removed.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Expected cash</span><strong>${nightCloseTotals.expected.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article><span>Actual cash</span><strong>${nightCloseTotals.actual.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>
            <article className={nightCloseHasMissingActual ? 'pending' : Math.abs(nightCloseTotals.discrepancy) < .01 ? 'balanced' : 'unbalanced'}><span>Over / short</span><strong>{nightCloseHasMissingActual ? 'Pending' : `${nightCloseTotals.discrepancy >= 0 ? '+' : '-'}$${Math.abs(nightCloseTotals.discrepancy).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</strong></article>
          </div>

          <section className="night-close-profit-panel" aria-label="Tonight's total profits">
            <div className="night-close-profit-tab">Total profits</div>
            <div className="night-close-profit-total">
              <span>Tonight's total</span>
              <strong>${nightCloseTotalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <small>Recorded drop + time fees + membership fees</small>
            </div>
            <div className="night-close-profit-breakdown">
              <article>
                <span>Recorded drop</span>
                <strong>${nightCloseFinancials.recordedDrop.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
              <article>
                <span>Time fees</span>
                <strong>${nightCloseFinancials.timeFees.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
              <article>
                <span>Membership fees</span>
                <strong>${nightCloseFinancials.membershipRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              </article>
            </div>
          </section>

          <section className="night-close-table-panel">
            <div className="night-close-section-title"><div><h3>Table reconciliation</h3><span>{nightCloseTables.length} tables in this shift</span></div><code>Buy-ins + time − cash-outs = expected; drop is reflected in cash-outs</code></div>
            <div className="night-close-table-head"><span>Table</span><span>Buy-ins</span><span>Cash-outs</span><span>Drop / time</span><span>Expected</span><span>Actual count</span><span>Over / short</span></div>
            <div className="night-close-table-list">
              {nightCloseTables.map((table) => <article className="night-close-table-row" key={table.tableId}>
                <div><strong>{table.tableLabel}</strong><span>{table.gameName}</span></div>
                <strong>${table.buyIns.toLocaleString()}</strong>
                <strong>${table.cashOuts.toLocaleString()}</strong>
                <strong>−${table.drop.toLocaleString(undefined, { maximumFractionDigits: 2 })} / +${table.timeFees.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                <strong>${table.expectedCash.toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong>
                <label><span>Actual cash</span><input type="number" min="0" step=".01" disabled={Boolean(currentNightClose && currentNightClose.status !== 'Draft')} value={effectiveNightCloseActuals[table.tableId] ?? ''} onChange={(event) => setNightCloseActuals((actuals) => ({ ...actuals, [table.tableId]: event.target.value }))} placeholder="$0.00" /></label>
                <strong className={(table.discrepancy ?? 0) === 0 ? 'balanced' : 'unbalanced'}>{table.discrepancy === undefined ? 'Not recorded' : `${table.discrepancy >= 0 ? '+' : '-'}$${Math.abs(table.discrepancy).toFixed(2)}`}</strong>
                {table.warnings.length ? <div className="night-close-row-warnings">{table.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : <div className="night-close-row-clear">Reconciled inputs complete</div>}
              </article>)}
              {!nightCloseTables.length ? <div className="night-close-empty"><strong>No current-shift tables</strong><span>Open or operate a table before starting night close.</span></div> : null}
            </div>
          </section>

          <div className="night-close-lower-grid">
            <section className="night-close-exceptions">
              <div className="night-close-section-title"><div><h3>Exceptions</h3><span>{nightCloseWarnings.length} items need review</span></div></div>
              {nightCloseWarnings.length ? <div>{nightCloseWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : <p>All tables have complete reconciliation inputs.</p>}
            </section>
            <section className="night-close-signoff">
              <div className="night-close-section-title"><div><h3>Approval</h3><span>Every action is retained in the audit log</span></div></div>
              <div className="night-close-operator">
                <label htmlFor="night-close-staff">Staff member using this station</label>
                {state.settings.staffAccounts.some((staff) => staff.active) ? (
                  <>
                    <select
                      id="night-close-staff"
                      value={state.settings.staffAccounts.some((staff) => staff.active && staff.id === state.settings.activeStaffId) ? state.settings.activeStaffId : ''}
                      onChange={(event) => selectActiveStaff(event.target.value)}
                      disabled={currentNightClose?.status === 'Locked'}
                    >
                      <option value="">Select a staff member</option>
                      {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => (
                        <option key={staff.id} value={staff.id}>{staff.name} - {staff.role}</option>
                      ))}
                    </select>
                    <small>
                      Select the staff signer first. After staff sign-off, select a Manager or Owner here to approve and lock.
                    </small>
                  </>
                ) : (
                  <div className="night-close-no-staff">
                    <span>No active staff accounts are available.</span>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={onOpenStaffSettings}
                    >
                      Add staff in Settings
                    </button>
                  </div>
                )}
              </div>
              <textarea value={nightCloseNotes || currentNightClose?.notes || ''} onChange={(event) => setNightCloseNotes(event.target.value)} disabled={Boolean(currentNightClose && currentNightClose.status !== 'Draft')} placeholder="Close notes, discrepancy explanation, cage count, or manager comments" />
              <div className="night-close-signatures">
                <article className={currentNightClose?.staffSignOff ? 'complete' : ''}><span>Staff sign-off</span><strong>{currentNightClose?.staffSignOff?.staffName ?? 'Pending'}</strong><small>{currentNightClose?.staffSignOff ? formatClock(currentNightClose.staffSignOff.timestamp) : 'Actual counts required'}</small></article>
                <article className={currentNightClose?.managerSignOff ? 'complete' : ''}><span>Manager approval</span><strong>{currentNightClose?.managerSignOff?.staffName ?? 'Pending'}</strong><small>{currentNightClose?.managerSignOff ? formatClock(currentNightClose.managerSignOff.timestamp) : 'Manager or Owner required'}</small></article>
              </div>
              {currentNightClose?.status !== 'Locked' ? <div className="night-close-actions">
                {!currentNightClose || currentNightClose.status === 'Draft' ? <><button className="ghost-button" onClick={() => saveNightClose()}>Save draft</button><button className="secondary-button" onClick={signNightClose}>Staff sign-off</button></> : null}
                <button className="primary-button" onClick={approveAndLockNightClose}>Approve & lock night</button>
              </div> : <div className="night-close-locked"><LockKeyhole size={17} /> Locked {currentNightClose.lockedAt ? new Date(currentNightClose.lockedAt).toLocaleString() : ''}</div>}
            </section>
          </div>

          {currentNightClose?.audit.length ? <section className="night-close-audit">
            <div className="night-close-section-title"><div><h3>Audit trail</h3><span>{currentNightClose.audit.length} recorded actions</span></div></div>
            <div>{[...currentNightClose.audit].reverse().map((entry) => <article key={entry.id}><time>{new Date(entry.timestamp).toLocaleString()}</time><strong>{entry.action}</strong><span>{entry.staffName}{entry.staffRole ? ` · ${entry.staffRole}` : ''}</span><em>{entry.note ?? ''}</em></article>)}</div>
          </section> : null}
        </section> : null}

        <section className="owner-summary-grid">
          <article className="panel owner-metric">
            <span>Occupied Seat-Hours</span>
            <strong>{analytics.currentNight.occupiedSeatHours.toFixed(1)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Avg Wait</span>
            <strong>{analytics.averageWaitMinutes.toFixed(0)}m</strong>
          </article>
          <article className="panel owner-metric">
            <span>Conversion</span>
            <strong>{(analytics.conversionRate * 100).toFixed(0)}%</strong>
          </article>
          <article className="panel owner-metric">
            <span>Games Started</span>
            <strong>{gamesStartedInPeriod}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Failed Starts</span>
            <strong>{analytics.failedStarts}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Table Breaks</span>
            <strong>{analytics.tableBreaks}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Median Wait</span>
            <strong>{analytics.medianWaitMinutes.toFixed(0)}m</strong>
          </article>
          <article className="panel owner-metric">
            <span>No-Shows</span>
            <strong>{analytics.noShows}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Left Wait</span>
            <strong>{analytics.leftBeforeSeated}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Confirmed Arrived</span>
            <strong>{(analytics.confirmedArrivalRate * 100).toFixed(0)}%</strong>
          </article>
          <article className="panel owner-metric">
            <span>Abandonment</span>
            <strong>{analytics.waitlistAbandonmentCount}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Lost Seat-Hours</span>
            <strong>{analytics.lostSeatHourEstimate.toFixed(1)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Second Tables</span>
            <strong>{analytics.secondTablesStarted}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Peak Wait</span>
            <strong>{analytics.peakWaitlistPressure}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Arrivals</span>
            <strong>{analytics.totalArrivals}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Time Fees</span>
            <strong>${reportFinancials.timeFees.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Expired Time</span>
            <strong>{analytics.expiredTimeFeeSeats}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Recorded Drop</span>
            <strong>${reportFinancials.recordedDrop.toFixed(0)}</strong>
          </article>
          <article className="panel owner-metric">
            <span>Drop Est.</span>
            <strong>${analytics.estimatedDropRevenue.toFixed(0)}</strong>
          </article>
        </section>

        <section className="panel summary-report">
          <PanelTitle icon={<Target />} title={`What Happened · ${reportWindow.label}`} />
          <p>
            The room generated {analytics.currentNight.occupiedSeatHours.toFixed(1)} occupied seat-hours across {gamesStartedInPeriod} tables.
            Average wait is {analytics.averageWaitMinutes.toFixed(0)} minutes, with {(analytics.conversionRate * 100).toFixed(0)}% waitlist conversion.
          </p>
          <p>
            Peak demand is {analytics.peakInterestedByGame ? `${analytics.peakInterestedByGame.game} with ${analytics.peakInterestedByGame.count} interested/in-room players` : 'not available yet'}.
            Failed starts: {analytics.failedStarts}. Table breaks: {analytics.tableBreaks}.
          </p>
          <div className="report-analysis-grid">
            <section className="report-analysis-card">
              <div className="report-analysis-heading">
                <div>
                  <span>Collections by time</span>
                  <h3>Money made each hour</h3>
                </div>
                <strong>{topEarningHour ? `${hourLabel(topEarningHour.startMs)} was highest` : 'Waiting for collection data'}</strong>
              </div>
              <div className="report-hour-list">
                {reportHourlyBreakdown.length ? reportHourlyBreakdown.map((item) => (
                  <article className={item.startMs === topEarningHour?.startMs ? 'top-hour' : ''} key={item.startMs}>
                    <time>{hourLabel(item.startMs)}</time>
                    <div><span>Drop</span><strong>${item.drop.toFixed(2)}</strong></div>
                    <div><span>Time</span><strong>${item.timeFees.toFixed(2)}</strong></div>
                    <div><span>Members/events</span><strong>${item.otherRevenue.toFixed(2)}</strong></div>
                    <div className="hour-total"><span>Total</span><strong>${item.total.toFixed(2)}</strong></div>
                  </article>
                )) : <p className="muted-copy">No drop or time-fee payments were recorded in this period.</p>}
              </div>
            </section>
            <section className="report-analysis-card">
              <div className="report-analysis-heading">
                <div>
                  <span>Dealer performance</span>
                  <h3>Who dealt each table</h3>
                </div>
              </div>
              <div className="report-dealer-list">
                {reportDealerBreakdown.length ? reportDealerBreakdown.map((dealer) => (
                  <article key={dealer.dealerName}>
                    <div><strong>{dealer.dealerName}</strong><span>{dealer.tables} table{dealer.tables === 1 ? '' : 's'} · {dealer.hours.toFixed(1)}h</span></div>
                    <div><span>Hands</span><strong>{dealer.hands}</strong></div>
                    <div><span>Hands/hr</span><strong>{dealer.handsPerHour.toFixed(1)}</strong></div>
                  </article>
                )) : <p className="muted-copy">No dealer downs tracked yet. Assign dealers from each table's Table admin section.</p>}
              </div>
            </section>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Seat-Hours by Game</h3>
              {analytics.seatHoursByGame.map((item) => (
                <span key={item.game}>{item.game}: {item.hours.toFixed(1)}</span>
              ))}
            </div>
            <div>
              <h3>Seat-Hours by Table</h3>
              {analytics.seatHoursByTable.slice(0, 6).map((item) => (
                <span key={`${item.table}-${item.game}`}>{item.table} ({item.game}): {item.hours.toFixed(1)}</span>
              ))}
            </div>
            <div>
              <h3>Wait by Game</h3>
              {analytics.waitByGame.map((item) => (
                <span key={item.game}>{item.game}: {item.count ? `${item.averageMinutes.toFixed(0)}m avg` : 'No seated waits'}</span>
              ))}
            </div>
            <div>
              <h3>Collection Value by Game</h3>
              {reportFinancials.collectionByGame.map((item) => (
                <span key={item.game}>
                  {item.game}: ${item.timeFees.toFixed(0)} time / ${item.recordedDrop.toFixed(0)} actual drop / ${(analytics.collectionValueByGame.find((estimate) => estimate.game === item.game)?.estimatedDrop ?? 0).toFixed(0)} est. drop
                </span>
              ))}
            </div>
            <div>
              <h3>Event Reasons</h3>
              {reportState.tableEvents.filter((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke').slice(-6).map((event: TableEvent) => (
                <span key={event.id}>{event.type}: {event.reason || 'Unspecified'}{event.note ? ` - ${event.note}` : ''}</span>
              ))}
              {!reportState.tableEvents.some((event: { type: string; }) => event.type === 'Failed to Start' || event.type === 'Broke') ? <span>No failed starts or breaks logged.</span> : null}
            </div>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Last 5 Nights</h3>
              {state.history.slice(-5).reverse().map((night) => (
                <span key={night.id}>
                  {night.date}: {night.occupiedSeatHours.toFixed(1)} seat-hours / {night.gamesStarted} starts / {(night.waitlistConversionRate * 100).toFixed(0)}% conversion / {night.averageActiveTables.toFixed(1)} avg tables
                </span>
              ))}
              {!state.history.length ? <span>No archived nights yet.</span> : null}
            </div>
            <div>
              <h3>Operational Opportunities</h3>
              {reportOpportunities.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
            <div>
              <h3>Correction Log</h3>
              {state.correctionLog.slice(0, 8).map((entry) => (
                <span key={entry.id}>{formatClock(entry.timestamp)} - {entry.entity}: {entry.field}</span>
              ))}
              {!state.correctionLog.length ? <span>No corrections logged.</span> : null}
            </div>
          </div>
          <div className="summary-breakdown">
            <div>
              <h3>Feature Usage</h3>
              {usageAnalytics.eventsByFeature.slice(0, 8).map((entry) => (
                <span key={entry.feature}>{entry.feature}: {entry.count} uses{entry.lastUsedAt ? ` / last ${formatClock(entry.lastUsedAt)}` : ''}</span>
              ))}
              {!usageAnalytics.eventsByFeature.length ? <span>No usage events recorded yet.</span> : null}
            </div>
            <div>
              <h3>Action Frequency</h3>
              {usageAnalytics.eventsByAction.slice(0, 8).map((entry) => (
                <span key={entry.key}>{entry.action}: {entry.count}</span>
              ))}
              {!usageAnalytics.eventsByAction.length ? <span>No tracked actions yet.</span> : null}
            </div>
            <div>
              <h3>Staff Activity</h3>
              {usageAnalytics.eventsByStaff.slice(0, 8).map((entry) => (
                <span key={entry.key}>{entry.staffName}{entry.staffRole ? ` (${entry.staffRole})` : ''}: {entry.count}</span>
              ))}
              {!usageAnalytics.eventsByStaff.length ? <span>No staff usage recorded yet.</span> : null}
            </div>
          </div>
          <textarea
            className="summary-notes"
            value={summaryNotes}
            onChange={(event) => setSummaryNotes(event.target.value)}
            placeholder="Owner-facing notes"
          />
          <button className="primary-button" onClick={() => setReportMode('close')}>
            <Save size={18} />
            Reconcile & Close Night
          </button>
        </section>
      </main>
  );
}
