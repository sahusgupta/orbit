import { deleteDoc, doc } from 'firebase/firestore';
import { deleteRemotePlayerIdentity } from '../api/playerHttpApi';
import { auth, db } from './firebaseClient';
import { deleteFirebasePlayer, signOutFirebasePlayer } from './playerAuth';

export async function deleteCurrentPlayerAccount() {
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in before deleting your account.');
  await deleteRemotePlayerIdentity(user);
  await deleteDoc(doc(db, 'players', user.uid));
  await deleteFirebasePlayer(user);
}

export async function signOutCurrentPlayer() {
  await signOutFirebasePlayer();
}
