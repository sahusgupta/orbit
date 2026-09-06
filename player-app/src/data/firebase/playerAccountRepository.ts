import { deleteRemotePlayerAccount } from '../api/playerHttpApi';
import { auth } from './firebaseClient';
import { signOutFirebasePlayer } from './playerAuth';

export async function deleteCurrentPlayerAccount(expectedUid?: string) {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  if (expectedUid && user.uid !== expectedUid) {
    throw new Error('The signed-in Orbit Player account changed before deletion.');
  }
  const result = await deleteRemotePlayerAccount(user);
  const currentUid = auth.currentUser?.uid ?? null;
  if (currentUid === result.initiatingUid) {
    await signOutFirebasePlayer().catch(() => undefined);
  }
  const uidAfterSignOut = auth.currentUser?.uid ?? null;
  const currentAccountPreserved = uidAfterSignOut !== null && uidAfterSignOut !== result.initiatingUid;
  const signedOut = uidAfterSignOut === null;
  return { ...result, currentAccountPreserved, signedOut };
}

export async function signOutCurrentPlayer() {
  await signOutFirebasePlayer();
}
