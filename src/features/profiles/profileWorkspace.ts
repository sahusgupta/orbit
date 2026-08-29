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
import type { AppState, IdentityCaptureMethod, PlayerProfile, TableTag } from '../../domain/types';
import { getTodayPlayerActivity, type TodayPlayerRowResult } from '../../lib/resultBuilders';

export type NewProfileDraft = {
  name: string;
  email: string;
  address: string;
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
  identityCaptureMethod?: IdentityCaptureMethod;
};

export type TodayPlayerRow = TodayPlayerRowResult;
export type PlayerPopup = 'add' | 'id' | 'ledger' | 'scan' | null;
export type PlayerSection = 'memberships' | 'requests' | 'today' | 'archive';

type ArchivablePlayerProfile = PlayerProfile & {
  archivedAt?: string;
  archivedReason?: string;
};

export const isArchivedOrExpiredProfile = (profile: PlayerProfile) => {
  const archivableProfile = profile as ArchivablePlayerProfile;
  if (archivableProfile.archivedAt || profile.membershipStatus === 'Expired') return true;
  const expiresAt = profile.membershipExpiresAt || profile.membershipExpirationDate;
  return profile.membershipStatus === 'Active' && Boolean(expiresAt) && !isFutureDate(expiresAt);
};

export const getProfileWorkspaceGroups = (profiles: PlayerProfile[]) => {
  const archivedProfiles = profiles.filter(isArchivedOrExpiredProfile);
  const availableProfiles = profiles.filter((profile) => !isArchivedOrExpiredProfile(profile));
  return {
    activeMemberProfiles: availableProfiles.filter((profile) =>
      profile.membershipStatus === 'Active' &&
      isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate)
    ),
    approvedMembershipProfiles: availableProfiles.filter((profile) => profile.membershipStatus === 'Approved'),
    archivedProfiles,
    membershipDirectoryProfiles: availableProfiles.filter((profile) =>
      profile.membershipStatus !== 'Requested' && profile.membershipStatus !== 'Approved'
    ),
    pendingMembershipProfiles: availableProfiles.filter((profile) => profile.membershipStatus === 'Requested')
  };
};

export const createNewProfileDraft = (): NewProfileDraft => ({
  name: '',
  email: '',
  address: '',
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
      .filter((profile) => !isArchivedOrExpiredProfile(profile))
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
      .filter((profile) => !isArchivedOrExpiredProfile(profile))
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
        profile.email ?? '',
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

  const {
    activeMemberProfiles,
    approvedMembershipProfiles,
    archivedProfiles,
    membershipDirectoryProfiles,
    pendingMembershipProfiles
  } = useMemo(() => getProfileWorkspaceGroups(filteredProfiles), [filteredProfiles]);
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
    archivedProfiles,
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
