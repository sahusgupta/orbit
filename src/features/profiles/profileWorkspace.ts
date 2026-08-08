import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction
} from 'react';
import type { IScannerControls } from '@zxing/browser';
import { nextYearDate, todayDate } from '../../domain/state';
import { isFutureDate } from '../../domain/licensing';
import type { AppState, PlayerProfile, TableTag } from '../../domain/types';
import { getTodayPlayerActivity, type TodayPlayerRowResult } from '../../lib/resultBuilders';

export type NewProfileDraft = {
  name: string;
  birthday: string;
  membershipStartDate: string;
  membershipExpirationDate: string;
  membershipPlan: 'day' | 'monthly';
  membershipAmount: number;
  totalTimePlayedHours: number;
  lastSessionTimePlayedHours: number;
  commonlyPlaysWithProfileIds: string[];
  preferredGameIds: string[];
  preferredGameId: string;
  phone: string;
  preferredStakes: string;
  typicalBuyInMin: number;
  typicalBuyInMax: number;
  usualCompanions: string;
  typicalAvailability: string;
  willingnessToMove: boolean;
  preferredTags: TableTag[];
  notes: string;
};

export type TodayPlayerRow = TodayPlayerRowResult;
export type PlayerPopup = 'add' | 'ledger' | 'scan' | null;
export type PlayerSection = 'memberships' | 'requests' | 'today';

export const createNewProfileDraft = (): NewProfileDraft => ({
  name: '',
  birthday: '',
  membershipStartDate: todayDate(),
  membershipExpirationDate: nextYearDate(),
  membershipPlan: 'monthly',
  membershipAmount: 0,
  totalTimePlayedHours: 0,
  lastSessionTimePlayedHours: 0,
  commonlyPlaysWithProfileIds: [],
  preferredGameIds: ['nlh-1-2'],
  preferredGameId: 'nlh-1-2',
  phone: '',
  preferredStakes: '',
  typicalBuyInMin: 200,
  typicalBuyInMax: 500,
  usualCompanions: '',
  typicalAvailability: '',
  willingnessToMove: true,
  preferredTags: [],
  notes: ''
});

export const useProfileFormState = () => {
  const [checkInSearch, setCheckInSearch] = useState('');
  const [newProfile, setNewProfile] = useState<NewProfileDraft>(createNewProfileDraft);
  const [importText, setImportText] = useState('');
  const [profileSearch, setProfileSearch] = useState('');
  const [profileFormMessage, setProfileFormMessage] = useState('');
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditDraft, setProfileEditDraft] = useState<PlayerProfile | null>(null);

  return {
    checkInSearch,
    editingProfileId,
    importText,
    newProfile,
    profileEditDraft,
    profileFormMessage,
    profileSearch,
    setCheckInSearch,
    setEditingProfileId,
    setImportText,
    setNewProfile,
    setProfileEditDraft,
    setProfileFormMessage,
    setProfileSearch
  };
};

export const usePlayerDialogState = () => {
  const [playerPopup, setPlayerPopup] = useState<PlayerPopup>(null);
  const [qrScanMessage, setQrScanMessage] = useState('Point the camera at an active Orbit membership QR code.');
  const [qrManualValue, setQrManualValue] = useState('');
  const [qrScanAttempt, setQrScanAttempt] = useState(0);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrScannerControlsRef = useRef<IScannerControls | null>(null);
  const [playerSection, setPlayerSection] = useState<PlayerSection>('memberships');

  return {
    playerPopup,
    playerSection,
    qrManualValue,
    qrScanAttempt,
    qrScanMessage,
    qrScannerControlsRef,
    qrVideoRef,
    setPlayerPopup,
    setPlayerSection,
    setQrManualValue,
    setQrScanAttempt,
    setQrScanMessage
  };
};

type ProfileWorkspaceSelectorOptions = {
  checkInSearch: string;
  profileSearch: string;
  state: AppState;
  toLocalDateValue: (date: Date) => string;
};

export const useProfileWorkspaceSelectors = ({
  checkInSearch,
  profileSearch,
  state,
  toLocalDateValue
}: ProfileWorkspaceSelectorOptions) => {
  const recentProfiles = useMemo(() => {
    const recentNames = [...state.interests]
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .map((interest) => interest.playerName.toLowerCase());
    return state.profiles
      .map((profile) => ({
        profile,
        recentIndex: recentNames.indexOf(profile.name.toLowerCase()),
        count: state.interests.filter((interest) => interest.playerName.toLowerCase() === profile.name.toLowerCase()).length
      }))
      .sort((left, right) =>
        (left.recentIndex === -1 ? 999 : left.recentIndex) - (right.recentIndex === -1 ? 999 : right.recentIndex) ||
        right.count - left.count
      )
      .slice(0, 4)
      .map((item) => item.profile);
  }, [state]);

  const checkInMatches = useMemo(() => {
    const queryParts = checkInSearch.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!queryParts.length) return recentProfiles;
    return state.profiles
      .filter((profile) => {
        const name = profile.name.toLowerCase();
        const nameParts = name.split(/\s+/);
        return queryParts.every((part) => name.includes(part) || nameParts.some((namePart) => namePart.startsWith(part)));
      })
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 8);
  }, [checkInSearch, recentProfiles, state.profiles]);

  const filteredProfiles = useMemo(() => {
    const query = profileSearch.trim().toLowerCase();
    if (!query) return state.profiles;
    return state.profiles.filter((profile) =>
      [
        profile.name,
        profile.id,
        profile.preferredStakes,
        profile.typicalAvailability,
        profile.usualCompanions.join(' '),
        profile.commonlyPlaysWithProfileIds
          .map((id) => state.profiles.find((candidate) => candidate.id === id)?.name)
          .filter(Boolean)
          .join(' '),
        profile.notes
      ].join(' ').toLowerCase().includes(query)
    );
  }, [state.profiles, profileSearch]);

  const activeMemberProfiles = useMemo(
    () => filteredProfiles.filter((profile) =>
      profile.membershipStatus === 'Active' &&
      isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate)
    ),
    [filteredProfiles]
  );
  const pendingMembershipProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus === 'Requested'),
    [filteredProfiles]
  );
  const approvedMembershipProfiles = useMemo(
    () => filteredProfiles.filter((profile) => profile.membershipStatus === 'Approved'),
    [filteredProfiles]
  );
  const membershipDirectoryProfiles = useMemo(
    () => filteredProfiles.filter((profile) =>
      profile.membershipStatus !== 'Requested' && profile.membershipStatus !== 'Approved'
    ),
    [filteredProfiles]
  );
  const todayPlayerActivity = useMemo<TodayPlayerRow[]>(
    () => getTodayPlayerActivity(state, { currentDate: new Date(), toLocalDateValue, isFutureDate }),
    [state.games, state.interests, state.playerSessions, state.profiles, state.sessions]
  );
  const duplicateProfiles = useMemo(() => {
    const groups = new Map<string, PlayerProfile[]>();
    state.profiles.forEach((profile) => {
      const key = profile.name.trim().toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), profile]);
    });
    return [...groups.values()].filter((group) => group.length > 1);
  }, [state.profiles]);

  return {
    activeMemberProfiles,
    approvedMembershipProfiles,
    checkInMatches,
    duplicateProfiles,
    membershipDirectoryProfiles,
    pendingMembershipProfiles,
    todayPlayerActivity
  };
};

type MembershipQrScannerOptions = {
  onCode: (value: string) => void;
  playerPopup: PlayerPopup;
  qrScanAttempt: number;
  qrScannerControlsRef: MutableRefObject<IScannerControls | null>;
  qrVideoRef: MutableRefObject<HTMLVideoElement | null>;
  setQrScanMessage: Dispatch<SetStateAction<string>>;
};

export const useMembershipQrScanner = ({
  onCode,
  playerPopup,
  qrScanAttempt,
  qrScannerControlsRef,
  qrVideoRef,
  setQrScanMessage
}: MembershipQrScannerOptions) => {
  useEffect(() => {
    if (playerPopup !== 'scan' || !qrVideoRef.current) return undefined;
    let disposed = false;
    setQrScanMessage('Starting camera…');
    import('@zxing/browser').then(({ BrowserQRCodeReader }) => {
      if (disposed || !qrVideoRef.current) return;
      const reader = new BrowserQRCodeReader();
      return reader.decodeFromVideoDevice(undefined, qrVideoRef.current, (result, _error, controls) => {
        if (!result || disposed) return;
        controls.stop();
        qrScannerControlsRef.current = null;
        onCode(result.getText());
      });
    }).then((controls) => {
      if (!controls) return;
      if (disposed) {
        controls.stop();
        return;
      }
      qrScannerControlsRef.current = controls;
      setQrScanMessage('Point the camera at an active Orbit membership QR code.');
    }).catch(() => {
      if (!disposed) setQrScanMessage('Camera unavailable. Use a USB scanner or paste the QR value below.');
    });

    return () => {
      disposed = true;
      qrScannerControlsRef.current?.stop();
      qrScannerControlsRef.current = null;
    };
  }, [playerPopup, qrScanAttempt]);
};

type MembershipQrDialogActionOptions = {
  onCode: (value: string) => void;
  qrManualValue: string;
  qrScannerControlsRef: MutableRefObject<IScannerControls | null>;
  setPlayerPopup: Dispatch<SetStateAction<PlayerPopup>>;
  setQrManualValue: Dispatch<SetStateAction<string>>;
  setQrScanAttempt: Dispatch<SetStateAction<number>>;
  setQrScanMessage: Dispatch<SetStateAction<string>>;
};

export const createMembershipQrDialogActions = ({
  onCode,
  qrManualValue,
  qrScannerControlsRef,
  setPlayerPopup,
  setQrManualValue,
  setQrScanAttempt,
  setQrScanMessage
}: MembershipQrDialogActionOptions) => ({
  openQrScanner: () => {
    setQrManualValue('');
    setQrScanMessage('Point the camera at an active Orbit membership QR code.');
    setQrScanAttempt((attempt) => attempt + 1);
    setPlayerPopup('scan');
  },
  restartQrScanner: () => {
    qrScannerControlsRef.current?.stop();
    qrScannerControlsRef.current = null;
    setQrScanMessage('Restarting camera…');
    setQrScanAttempt((attempt) => attempt + 1);
  },
  submitQrManual: (event: FormEvent) => {
    event.preventDefault();
    qrScannerControlsRef.current?.stop();
    qrScannerControlsRef.current = null;
    onCode(qrManualValue);
  }
});
