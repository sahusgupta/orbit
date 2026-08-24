import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { hasPersistedSignIn, isPilotAccessActive } from '../../domain/licensing';
import type { AppState, ClubAccount, PilotAccess, StaffRole } from '../../domain/types';

export type SettingsSection = 'club' | 'staff' | 'tables' | 'data' | 'display' | 'legal';
export type StaffDraft = { name: string; role: StaffRole; pin: string };
export type BackendStatus = { running: boolean; host: string; port: number; reportCount: number };
export type SaveStatus =
  | { state: 'idle'; message: string }
  | { state: 'saving'; message: string }
  | { state: 'saved'; message: string }
  | { state: 'error'; message: string };
export type LoginDraft = { username: string; password: string; staySignedIn: boolean };
export type PasswordRecoveryStage =
  | 'idle'
  | 'sending'
  | 'sent'
  | 'verifying'
  | 'owner-checking'
  | 'owner-ready'
  | 'owner-completing';
export type SetupDraft = {
  username: string;
  password: string;
  confirmPassword: string;
  initialGames: string;
  defaultCollectionMode: 'Time' | 'Drop';
  defaultHourlyFee: number;
  defaultEstimatedDropPerSeatHour: number;
  staySignedIn: boolean;
};

export const emptyClubAccount: ClubAccount = {
  clubName: '',
  accountName: '',
  contactName: '',
  email: '',
  phone: '',
  address: ''
};

export const useSettingsWorkspaceState = (state: AppState) => {
  const [pendingPilotAccess, setPendingPilotAccess] = useState<PilotAccess | null>(null);
  const [pilotKeyError, setPilotKeyError] = useState('');
  const [hasAuthenticated, setHasAuthenticated] = useState(() => hasPersistedSignIn(state));
  const [loginDraft, setLoginDraft] = useState<LoginDraft>({ username: '', password: '', staySignedIn: false });
  const [passwordRecoveryStage, setPasswordRecoveryStage] = useState<PasswordRecoveryStage>('idle');
  const [passwordRecoveryNotice, setPasswordRecoveryNotice] = useState('');
  const [setupDraft, setSetupDraft] = useState<SetupDraft>({
    username: '',
    password: '',
    confirmPassword: '',
    initialGames: '',
    defaultCollectionMode: 'Drop',
    defaultHourlyFee: 0,
    defaultEstimatedDropPerSeatHour: 0,
    staySignedIn: true
  });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle', message: 'Ready' });
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [clubDraft, setClubDraft] = useState<ClubAccount>(() => state.settings.clubAccount ?? emptyClubAccount);
  const [staffDraft, setStaffDraft] = useState<StaffDraft>({ name: '', role: 'Floor', pin: '' });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('club');
  const [reportMessage, setReportMessage] = useState('');
  const [backupMessage, setBackupMessage] = useState('');
  const [selfCheckInKitMessage, setSelfCheckInKitMessage] = useState('');

  return {
    backendStatus,
    backupMessage,
    clubDraft,
    hasAuthenticated,
    loginDraft,
    passwordRecoveryNotice,
    passwordRecoveryStage,
    pendingPilotAccess,
    pilotKeyError,
    reportMessage,
    saveStatus,
    selfCheckInKitMessage,
    settingsSection,
    setupDraft,
    staffDraft,
    setBackendStatus,
    setBackupMessage,
    setClubDraft,
    setHasAuthenticated,
    setLoginDraft,
    setPasswordRecoveryNotice,
    setPasswordRecoveryStage,
    setPendingPilotAccess,
    setPilotKeyError,
    setReportMessage,
    setSaveStatus,
    setSelfCheckInKitMessage,
    setSettingsSection,
    setSetupDraft,
    setStaffDraft
  };
};

type SettingsWorkspaceSyncOptions = {
  setClubDraft: Dispatch<SetStateAction<ClubAccount>>;
  setHasAuthenticated: Dispatch<SetStateAction<boolean>>;
  state: AppState;
};

export const useSettingsWorkspaceSync = ({
  setClubDraft,
  setHasAuthenticated,
  state
}: SettingsWorkspaceSyncOptions) => {
  useEffect(() => {
    setClubDraft(state.settings.clubAccount ?? emptyClubAccount);
  }, [state.settings.clubAccount]);

  useEffect(() => {
    if (!isPilotAccessActive(state.settings.pilotAccess)) {
      setHasAuthenticated(false);
    }
  }, [state.settings.pilotAccess]);
};
