import React, { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { Pressable, Text, View, type ViewProps } from 'react-native';
import type { usePlayerStorage as ConnectedStorageHook } from '../../../player-app/src/application/usePlayerStorage';
import type { usePlayerIdentity as ConnectedIdentityHook } from '../../../player-app/src/application/usePlayerIdentity';
import type { usePlayerLiveData as ConnectedLiveDataHook } from '../../../player-app/src/application/usePlayerLiveData';
import type { MatchPersistencePort } from '../../../player-app/src/application/playerMatchController';
import type { PlayerPlatform } from '../../../player-app/src/app/playerPlatform';
import type { PlayerLocationPort } from '../../../player-app/src/app/playerLocation';
import type { PlayerAccount, PlayerClubSnapshot, PlayerTournamentInterest } from '../../../player-app/src/domain/playerSync';
import type { MatchJournal } from '../../../player-app/src/domain/orbitMatchTypes';
import type { PlayerLocalOrigin } from '../../../player-app/src/domain/playerLocation';
import { nativeTextContrast } from '../../../player-app/src/test-utils/nativeContrast';
import { usePlayerTheme } from '../../../player-app/src/styles/PlayerThemeProvider';

const audit = { connectedMounts: { storage: 0, identity: 0, liveData: 0 }, mountedConnected: 0, storageCalls: [] as string[], forbiddenCalls: [] as string[] };
declare global { interface Window { __ORBIT_SHELL_QA__: { audit: () => typeof audit; contrastFailures: () => { text: string; ratio: number }[] }; } }
window.__ORBIT_SHELL_QA__ = { audit: () => structuredClone(audit), contrastFailures: () => Array.from(document.querySelectorAll('[dir="auto"]'))
  .filter((element) => element.getClientRects().length && !element.closest('[aria-hidden="true"], [aria-disabled="true"]'))
  .map((element) => ({ text: element.textContent ?? '', ratio: nativeTextContrast(element) })).filter((item) => item.ratio < 4.5) };
function deny(name: string): never { audit.forbiddenCalls.push(name); throw new Error(`Live capability unavailable in isolated shell QA: ${name}`); }
function useConnectedAudit(kind: keyof typeof audit.connectedMounts) {
  useEffect(() => { audit.connectedMounts[kind] += 1; audit.mountedConnected += 1; return () => { audit.mountedConnected -= 1; }; }, [kind]);
}

/** Connected state is a fixture. Only the demo session uses the actual application hook and inventory. */
export function usePlayerStorage(emptyPlayer: PlayerAccount): ReturnType<typeof ConnectedStorageHook> {
  useConnectedAudit('storage');
  const initial = useMemo(() => new URLSearchParams(location.search).get('entry') === 'profile'
    ? { ...emptyPlayer, id: 'local-shell-qa-profile', name: 'Local QA Profile', email: 'shell-qa@example.test', adultDeclaredAt: new Date().toISOString(), adultDeclarationVersion: 'v1' as const } : emptyPlayer, []);
  const [player, setPlayer] = useState(initial), [draftPlayer, setDraftPlayer] = useState(initial);
  const [hasAccount, setHasAccount] = useState(Boolean(initial.id));
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2 | 3>(0);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  return { accountLoaded: true, dismissedAlertsLoaded: true, playerStorageError: '', player, draftPlayer, hasAccount, onboardingStep, dismissedNotificationIds,
    setPlayer, setDraftPlayer, setHasAccount, setOnboardingStep, retryPlayerStorage: () => undefined,
    dismissInAppAlert: (id) => setDismissedNotificationIds((current) => [...current, id]),
    clearLocalPlayer: async () => { setPlayer(emptyPlayer); setDraftPlayer(emptyPlayer); setHasAccount(false); } };
}
export function usePlayerIdentity(options: Parameters<typeof ConnectedIdentityHook>[0]): ReturnType<typeof ConnectedIdentityHook> {
  useConnectedAudit('identity');
  const [playerAuthMethod, setPlayerAuthMethod] = useState<'email' | 'phone'>('email');
  const [playerAuthEmail, setPlayerAuthEmail] = useState(''), [playerAuthCode, setPlayerAuthCode] = useState('');
  const [playerAuthPassword, setPlayerAuthPassword] = useState(''), [playerAuthPhone, setPlayerAuthPhone] = useState('');
  return {
    authLoaded: true, authInitializationError: '', authStatus: 'Local QA fixture. Real sign-in is unavailable in this harness.', firebaseIdentity: null,
    identityBusy: false, identityMessage: '', identityRequiredMinimumAge: 18, identityReturnScreen: 'home',
    identityStatus: { status: 'unverified', ageVerified: false, ageEligible: false, ageLevel: 0, minimumAge: 18,
      verifiedAt: null, capturedAt: null, failureCode: null, reviewStatus: 'not-started', verifiedDetails: null },
    playerAuthMethod, playerAuthEmail, playerAuthCode, playerAuthPassword, playerAuthPhone, playerPhoneChallenge: false, profileSyncPaused: false,
    setPlayerAuthMethod, setPlayerAuthEmail, setPlayerAuthCode, setPlayerAuthPassword, setPlayerAuthPhone,
    completeAccount: async () => { options.setPlayer({ ...options.draftPlayer, id: 'local-shell-qa-profile' }); options.setHasAccount(true); },
    connectPlayerAccount: async () => deny('sign-in'), recoverPlayerAccount: async () => deny('account recovery'),
    refreshIdentityVerification: async () => deny('identity refresh'), requireVerifiedAge: () => false, retryAuthInitialization: () => undefined,
    showIdentityVerification: () => deny('identity capture'), restartPlayerPhoneSignIn: () => deny('phone sign-in'),
    signOutPlayer: async () => deny('sign-out'), startIdentityVerification: async () => deny('identity verification'), deletePlayerAccount: () => deny('account deletion')
  };
}
export function usePlayerLiveData(): ReturnType<typeof ConnectedLiveDataHook> {
  useConnectedAudit('liveData');
  const [clubs, setClubs] = useState<PlayerClubSnapshot[]>([]), [tournamentInterests, setTournamentInterests] = useState<PlayerTournamentInterest[]>([]);
  const [selectedClubId, setSelectedClubId] = useState(''), [clubMembershipMessage, setClubMembershipMessage] = useState(''), [clubSelectionNotice, setClubSelectionNotice] = useState('');
  return { clubs, setClubs, tournamentInterests, setTournamentInterests, selectedClubId, setSelectedClubId, clubMembershipMessage, setClubMembershipMessage,
    clubSelectionNotice, setClubSelectionNotice, clockNow: Date.now(), liveDataPartial: false, liveDataStatus: 'error', profileEditingReady: true,
    profileSyncNotice: '', retryLiveData: () => undefined, tournamentLoadError: '', tournaments: [] };
}
const journals = new Map<string, MatchJournal>();
export const playerStorage = {
  async loadMatchJournal(uid: string) { audit.storageCalls.push('loadMatchJournal'); return journals.get(uid) ?? null; },
  async saveMatchJournal(uid: string, journal: MatchJournal) { audit.storageCalls.push('saveMatchJournal'); journals.set(uid, structuredClone(journal)); },
  async loadLocalOrigin(_owner: string): Promise<PlayerLocalOrigin | null> { audit.storageCalls.push('loadLocalOrigin'); return null; },
  async saveLocalOrigin(_owner: string, _record: PlayerLocalOrigin) { deny('save location'); }, async clearLocalOrigin() { deny('clear location'); }
};
export const playerMatchPersistence: MatchPersistencePort = {
  loadJournal: async () => deny('account journal'), saveJournal: async () => deny('account journal write'), fetchState: async () => deny('account Match read'),
  mutate: async () => deny('account Match write'), subscribe: () => deny('Firebase Match subscription')
};
export const playerLocation: PlayerLocationPort = { getOneShotPosition: async () => deny('GPS permission/location') };
export const playerPlatform: PlayerPlatform = { os: 'web', getCurrentAppState: () => 'active', subscribeToAppState: () => () => undefined,
  openDirections: async () => deny('OS directions'), openAppSettings: async () => deny('OS settings'),
  confirmAccountDeletion: () => deny('account deletion confirmation'), confirmLocalProfileDeletion: () => deny('profile deletion confirmation'),
  showAccountDeletionResult: () => deny('account deletion result'), showLocalProfileDeletionResult: () => deny('profile deletion result') };
export function isSyncConfigured() { return false; }
export function getCurrentFirebasePlayer() { return null; }
export function submitWaitlistRequest() { return deny('waitlist request'); }
export function submitMembershipRequest() { return deny('membership request'); }
export function issueRemoteMembershipQr() { return deny('QR issuance'); }
export function expressTournamentInterest() { return deny('tournament interest'); }
export function withdrawTournamentInterest() { return deny('tournament withdrawal'); }
export function registerForTournament() { return deny('tournament registration'); }

// Native device surfaces are explicit presentation adapters; no permissions or external map tiles load.
export function SafeAreaProvider({ children }: PropsWithChildren) { return <View style={{ flex: 1 }}>{children}</View>; }
export function SafeAreaView({ children, style }: ViewProps) { return <View style={style}>{children}</View>; }
export function StatusBar() { return null; }
export function CameraView() { return <Text>Camera hardware is unavailable in browser QA.</Text>; }
export function useCameraPermissions() { return [null, async () => deny('camera permission')] as const; }
export const PROVIDER_GOOGLE = 'qa-map-provider';
export function Marker({ title, onPress }: { title?: string; onPress?: () => void }) {
  const { colors } = usePlayerTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={`QA map pin ${title}`} onPress={onPress}><Text style={{ color: colors.ink }}>{title}</Text></Pressable>;
}
export function Circle() { return null; }
export default function MapView({ children, style }: ViewProps) {
  const { colors } = usePlayerTheme();
  return <View style={style}><Text style={{ color: colors.muted }}>Map canvas adapter · no tiles or OS handoff</Text>{children}</View>;
}
