import { useMemo, useState } from 'react';
import {
  getDealerReport,
  getReportFinancials,
  getReportHourlyBreakdown,
  getReportState,
  getReportWindow
} from '../../domain/reporting';
import {
  getAnalytics,
  getOperationalOpportunities,
  getUsageAnalytics
} from '../../domain/analytics';
import { todayDate } from '../../domain/state';
import type { AppState, ReportPeriod } from '../../domain/types';
import { buildNightCloseTables } from '../../lib/nightClose';

export type ReportMode = 'kpis' | 'night' | 'close';
export type KpiCategory = 'operations' | 'waitlist' | 'tables' | 'collections';

export const toLocalDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const useReportingWorkspaceState = () => {
  const [summaryNotes, setSummaryNotes] = useState('');
  const [reportMode, setReportMode] = useState<ReportMode>('kpis');
  const [nightCloseActuals, setNightCloseActuals] = useState<Record<string, string>>({});
  const [nightCloseNotes, setNightCloseNotes] = useState('');
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('day');
  const [reportAnchorDate, setReportAnchorDate] = useState(() => toLocalDateValue(new Date()));
  const [kpiCategory, setKpiCategory] = useState<KpiCategory>('operations');

  return {
    kpiCategory,
    nightCloseActuals,
    nightCloseNotes,
    reportAnchorDate,
    reportMode,
    reportPeriod,
    summaryNotes,
    setKpiCategory,
    setNightCloseActuals,
    setNightCloseNotes,
    setReportAnchorDate,
    setReportMode,
    setReportPeriod,
    setSummaryNotes
  };
};

type ReportingWorkspaceSelectorsOptions = {
  clockNow: number;
  reportAnchorDate: string;
  reportPeriod: ReportPeriod;
  state: AppState;
};

export const useReportingWorkspaceSelectors = ({
  clockNow,
  reportAnchorDate,
  reportPeriod,
  state
}: ReportingWorkspaceSelectorsOptions) => {
  const analytics = useMemo(() => getAnalytics(state), [state]);
  const reportWindow = useMemo(
    () => getReportWindow(reportPeriod, reportAnchorDate),
    [reportPeriod, reportAnchorDate]
  );
  const reportState = useMemo(() => getReportState(state, reportWindow), [state, reportWindow]);
  const reportAnalytics = useMemo(() => getAnalytics(reportState), [reportState]);
  const reportFinancials = useMemo(() => getReportFinancials(state, reportWindow), [state, reportWindow]);
  const nightCloseReportDate = toLocalDateValue(new Date(clockNow));
  const nightCloseReportWindow = useMemo(
    () => getReportWindow('day', nightCloseReportDate),
    [nightCloseReportDate]
  );
  const nightCloseFinancials = useMemo(
    () => getReportFinancials(state, nightCloseReportWindow),
    [state, nightCloseReportWindow]
  );
  const nightCloseTotalProfit =
    nightCloseFinancials.recordedDrop + nightCloseFinancials.timeFees + nightCloseFinancials.membershipRevenue;
  const reportHourlyBreakdown = useMemo(
    () => getReportHourlyBreakdown(state, reportWindow, reportFinancials),
    [state, reportWindow, reportFinancials]
  );
  const reportDealerBreakdown = useMemo(() => getDealerReport(state, reportWindow), [state, reportWindow]);
  const reportOpportunities = useMemo(
    () => getOperationalOpportunities(reportState, reportAnalytics),
    [reportState, reportAnalytics]
  );
  const currentReportWindow = getReportWindow(reportPeriod, toLocalDateValue(new Date()));
  const reportIsCurrentPeriod = reportPeriod === 'all' || reportWindow.startMs >= currentReportWindow.startMs;
  const usageAnalytics = useMemo(() => getUsageAnalytics(state), [state]);
  const operationalOpportunities = useMemo(
    () => getOperationalOpportunities(state, analytics),
    [state, analytics]
  );

  return {
    analytics,
    nightCloseFinancials,
    nightCloseTotalProfit,
    operationalOpportunities,
    reportAnalytics,
    reportDealerBreakdown,
    reportFinancials,
    reportHourlyBreakdown,
    reportIsCurrentPeriod,
    reportOpportunities,
    reportState,
    reportWindow,
    usageAnalytics
  };
};

export const getNightCloseWorkspace = (state: AppState, nightCloseActuals: Record<string, string>) => {
  const currentNightClose = state.nightCloses
    .filter((close) => close.date === todayDate())
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const savedNightCloseActuals = Object.fromEntries(
    (currentNightClose?.tables ?? []).map((table) => [
      table.tableId,
      table.actualCash === undefined ? '' : String(table.actualCash)
    ])
  );
  const effectiveNightCloseActuals = { ...savedNightCloseActuals, ...nightCloseActuals };
  const calculatedNightCloseTables = buildNightCloseTables(state, effectiveNightCloseActuals);
  const nightCloseTables = currentNightClose?.status === 'Locked'
    ? currentNightClose.tables
    : calculatedNightCloseTables;
  const nightCloseWarnings = Array.from(new Set(
    nightCloseTables.flatMap((table) => table.warnings.map((warning) => `${table.tableLabel}: ${warning}`))
  ));
  const nightCloseTotals = nightCloseTables.reduce((totals, table) => ({
    buyIns: totals.buyIns + table.buyIns,
    cashOuts: totals.cashOuts + table.cashOuts,
    removed: totals.removed + table.drop + table.timeFees,
    expected: totals.expected + table.expectedCash,
    actual: totals.actual + (table.actualCash ?? 0),
    discrepancy: totals.discrepancy + (table.discrepancy ?? 0)
  }), { buyIns: 0, cashOuts: 0, removed: 0, expected: 0, actual: 0, discrepancy: 0 });
  const nightCloseHasMissingActual = nightCloseTables.some((table) => table.actualCash === undefined);

  return {
    currentNightClose,
    effectiveNightCloseActuals,
    nightCloseHasMissingActual,
    nightCloseTables,
    nightCloseTotals,
    nightCloseWarnings
  };
};
