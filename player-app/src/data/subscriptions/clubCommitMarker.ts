import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/firebaseClient';

type Subscriber = {
  onChange(): void;
  onError(error: Error): void;
};

const subscribers = new Set<Subscriber>();
let releaseFirestoreListener: (() => void) | null = null;

export function subscribeToClubCommitMarker(onChange: () => void, onError: (error: Error) => void) {
  const subscriber = { onChange, onError };
  subscribers.add(subscriber);
  if (!releaseFirestoreListener) {
    releaseFirestoreListener = onSnapshot(
      collection(db, 'clubs'),
      () => subscribers.forEach((current) => current.onChange()),
      (error) => subscribers.forEach((current) => current.onError(error))
    );
  }
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size && releaseFirestoreListener) {
      releaseFirestoreListener();
      releaseFirestoreListener = null;
    }
  };
}
