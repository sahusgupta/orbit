import { firebaseConfig } from './firebaseConfig';

export {
  createClubMembershipCheckout,
  createPlayerIdentityVerificationSession,
  fetchPlayerIdentityStatus,
  orbitApiBaseUrl
} from './api/playerHttpApi';
export type { PlayerIdentityStatus } from './api/playerHttpApi';

export {
  ensureSignedInIdentity,
  completePlayerPhoneSignIn,
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
  fetchPlayerProfile,
  savePlayerProfile,
  updatePlayerClubMembership
} from './firebase/playerProfileRepository';

export {
  fetchPlayerTournaments,
  registerForTournament,
  subscribeToPlayerTournaments,
  unregisterFromTournament
} from './firebase/playerTournamentRepository';

export {
  fetchPrivateGameListings,
  submitPrivateGameListing,
  subscribeToPrivateGameListings
} from './firebase/privateGameRepository';

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
  return true;
}
