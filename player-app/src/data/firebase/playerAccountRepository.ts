import { deleteRemotePlayerAccount } from '../api/playerHttpApi';
import { auth } from './firebaseClient';
import { signOutFirebasePlayer } from './playerAuth';

export async function deleteCurrentPlayerAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  const result = await deleteRemotePlayerAccount(user);
  await signOutFirebasePlayer();
  return result;
}

export async function signOutCurrentPlayer() {
  await signOutFirebasePlayer();
}
