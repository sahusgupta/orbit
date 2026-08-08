import { useEffect, useState } from 'react';
import type { AppState, InterestStatus } from '../../domain/types';

export type QuickAddForm = {
  playerName: string;
  gameId: string;
  status: InterestStatus;
  notes: string;
  tableId: string;
  seatNumber: string;
  initialBuyIn: string;
};

export type EventDraft = {
  failReason: string;
  failNote: string;
  breakReason: string;
  breakNote: string;
};

export type MoneyDraft = { amount: string; note: string };
export type OpenPanels = Record<string, boolean>;

export type SeatPickerState = {
  sessionId: string;
  seatNumber: number;
  search: string;
  timeMinutes: string;
  initialBuyIn: string;
  error?: string;
};

export type CashOutDraft = MoneyDraft & { playerSessionId: string };

export const useFloorWorkspaceState = (state: AppState) => {
  const [form, setForm] = useState<QuickAddForm>({
    playerName: '',
    gameId: 'nlh-1-2',
    status: 'Confirmed Coming',
    notes: '',
    tableId: '',
    seatNumber: '',
    initialBuyIn: ''
  });
  const [eventDrafts, setEventDrafts] = useState<Record<string, EventDraft>>({});
  const [seatPicker, setSeatPicker] = useState<SeatPickerState | null>(null);
  const [startPlayerDrafts, setStartPlayerDrafts] = useState<Record<string, string[]>>({});
  const [formingGameId, setFormingGameId] = useState(() => state.games[0]?.id ?? '');
  const [tableLedgerSessionId, setTableLedgerSessionId] = useState<string | null>(null);
  const [tableEventLogSessionId, setTableEventLogSessionId] = useState<string | null>(null);
  const [cashOutDraft, setCashOutDraft] = useState<CashOutDraft | null>(null);
  const [buyInDrafts, setBuyInDrafts] = useState<Record<string, MoneyDraft>>({});
  const [dropDrafts, setDropDrafts] = useState<Record<string, MoneyDraft>>({});
  const [dealerDrafts, setDealerDrafts] = useState<Record<string, string>>({});
  const [handCountDrafts, setHandCountDrafts] = useState<Record<string, string>>({});
  const [customTimeDrafts, setCustomTimeDrafts] = useState<Record<string, string>>({});
  const [collapsedTables, setCollapsedTables] = useState<Record<string, boolean>>({});
  const [openPanels, setOpenPanels] = useState<OpenPanels>({
    currentTables: true,
    waitlist: true,
    tableOverview: true,
    tableFinancials: true,
    recentActivity: true,
    formingGames: true,
    kpis: false,
    quickAdd: false
  });
  const [overviewTableId, setOverviewTableId] = useState('all-time-overview');
  const [financialOverviewTableId, setFinancialOverviewTableId] = useState('all-table-financials');
  const [waitlistPopupOpen, setWaitlistPopupOpen] = useState(false);

  useEffect(() => {
    if (!openPanels.quickAdd) return;
    const closeQuickAddOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenPanels((panels) => ({ ...panels, quickAdd: false }));
      }
    };
    window.addEventListener('keydown', closeQuickAddOnEscape);
    return () => window.removeEventListener('keydown', closeQuickAddOnEscape);
  }, [openPanels.quickAdd]);

  return {
    buyInDrafts,
    cashOutDraft,
    collapsedTables,
    customTimeDrafts,
    dealerDrafts,
    dropDrafts,
    eventDrafts,
    financialOverviewTableId,
    form,
    formingGameId,
    handCountDrafts,
    openPanels,
    overviewTableId,
    seatPicker,
    startPlayerDrafts,
    tableEventLogSessionId,
    tableLedgerSessionId,
    waitlistPopupOpen,
    setBuyInDrafts,
    setCashOutDraft,
    setCollapsedTables,
    setCustomTimeDrafts,
    setDealerDrafts,
    setDropDrafts,
    setEventDrafts,
    setFinancialOverviewTableId,
    setForm,
    setFormingGameId,
    setHandCountDrafts,
    setOpenPanels,
    setOverviewTableId,
    setSeatPicker,
    setStartPlayerDrafts,
    setTableEventLogSessionId,
    setTableLedgerSessionId,
    setWaitlistPopupOpen
  };
};
