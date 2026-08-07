import { Download, X } from 'lucide-react';
import type { getAnalytics } from '../domain/analytics';

type KpisViewProps = {
  analytics: ReturnType<typeof getAnalytics>;
  onClose: () => void;
  onExportCsv: () => void;
};

export default function KpisView({ analytics, onClose, onExportCsv }: KpisViewProps) {
  return (
    <main className="app-shell compact-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Operating metrics</div>
          <h1>KPIs</h1>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" onClick={onExportCsv}>
            <Download size={18} />
            CSV
          </button>
          <button className="ghost-button" onClick={onClose}>
            <X size={18} />
            Close
          </button>
        </div>
      </header>

      <section className="owner-summary-grid">
        <article className="panel owner-metric">
          <span>Seat-Hours</span>
          <strong>{analytics.currentNight.occupiedSeatHours.toFixed(1)}</strong>
        </article>
        <article className="panel owner-metric">
          <span>Active Tables</span>
          <strong>{analytics.activeTables}</strong>
        </article>
        <article className="panel owner-metric">
          <span>Average Wait</span>
          <strong>{analytics.averageWaitMinutes.toFixed(0)}m</strong>
        </article>
        <article className="panel owner-metric">
          <span>Conversion</span>
          <strong>{(analytics.conversionRate * 100).toFixed(0)}%</strong>
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
          <span>Time Fees Est.</span>
          <strong>${analytics.estimatedTimeFeeRevenue.toFixed(0)}</strong>
        </article>
        <article className="panel owner-metric">
          <span>Recorded Drop</span>
          <strong>${analytics.recordedDropTotal.toFixed(0)}</strong>
        </article>
        <article className="panel owner-metric">
          <span>Drop Est.</span>
          <strong>${analytics.estimatedDropRevenue.toFixed(0)}</strong>
        </article>
        <article className="panel owner-metric">
          <span>Expired Time</span>
          <strong>{analytics.expiredTimeFeeSeats}</strong>
        </article>
      </section>
    </main>
  );
}
