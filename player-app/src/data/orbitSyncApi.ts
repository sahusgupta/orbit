import { firebaseConfig } from './firebaseConfig';
import { orbitApiBaseUrl } from './api/playerHttpApi';

export {
  fetchPublicPlayerDiscovery,
  fetchRemotePlayerDiscovery,
  fetchPlayerIdentityStatus,
  issueRemoteMembershipQr,
  orbitApiBaseUrl,
  savePlayerIdentityCapture
} from './api/playerHttpApi';
export type { PlayerIdentityStatus } from './api/playerHttpApi';

export {
  ensureSignedInIdentity,
  completePlayerPhoneSignIn,
  getCurrentFirebaseAuthUid,
  getCurrentFirebasePlayer,
  onFirebasePlayerChanged,
  requestPlayerPasswordReset,
  signInOrCreatePlayerWithEmail,
  startPlayerPhoneSignIn
} from './firebase/playerAuth';
export type { FirebasePlayerIdentity } from './firebase/playerAuth';

export {
  deleteCurrentPlayerAccount,
  signOutCurrentPlayer
} from './firebase/playerAccountRepository';

export {
  fetchAllClubSnapshots,
  fetchClubSnapshot,
  fetchClubSnapshots
} from './firebase/clubSnapshotRepository';

export {
  completePlayerAdultDeclarationIfMissing,
  createPlayerProfileIfMissing,
  fetchPlayerProfile,
  savePlayerProfile
} from './firebase/playerProfileRepository';

export {
  fetchPlayerTournaments,
  expressTournamentInterest,
  subscribeToPlayerTournaments,
  withdrawTournamentInterest
} from './firebase/playerTournamentRepository';

export {
  submitMembershipRequest,
  submitWaitlistRequest
} from './firebase/playerRequestRepository';

export {
  cardHouseGameRefreshIntervalMs,
  subscribeToAllClubSnapshots
} from './subscriptions/clubSnapshotSubscription';

export { normalizePublishedGames } from '../domain/decoders/playerGameDecoder';

export const syncBaseUrl = `firebase://${firebaseConfig.projectId}/clubs`;

export function isSyncConfigured() {
  return Boolean(orbitApiBaseUrl);
}
