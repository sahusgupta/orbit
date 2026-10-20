import { doc, onSnapshot } from 'firebase/firestore';
import { decodeMatchState } from '../../../../apps/api/src/shared/orbitMatchState.cjs';
import type { MatchPersistencePort } from '../../domain/orbitMatchTypes';
import { fetchRemoteMatchState, submitRemoteMatchOperation } from '../api/playerHttpApi';
import { playerStorage } from '../storage/playerStorage';
import { auth, db } from './firebaseClient';

export const playerMatchPersistence: MatchPersistencePort = {
  loadJournal: (uid) => playerStorage.loadMatchJournal(uid),
  saveJournal: (uid, journal) => playerStorage.saveMatchJournal(uid, journal),
  fetchState: fetchRemoteMatchState,
  mutate: submitRemoteMatchOperation,
  subscribe(uid, onState, onError) {
    if (auth.currentUser?.uid !== uid) {
      onError(new Error('Sign in to restore Match on your other devices.'));
      return () => undefined;
    }
    return onSnapshot(doc(db, 'players', uid, 'orbitMatch', 'state'), (snapshot) => {
      if (auth.currentUser?.uid !== uid) return;
      if (!snapshot.exists()) return;
      // Cached/pending SDK snapshots cannot make availability or server writes authoritative.
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      const state = decodeMatchState(snapshot.data());
      if (!state) { onError(new Error('Saved Match data is invalid. Retry sync.')); return; }
      onState(state);
    }, (failure) => {
      if (auth.currentUser?.uid === uid) onError(new Error('Could not sync your Match data. Try again shortly.', { cause: failure }));
    });
  }
};
