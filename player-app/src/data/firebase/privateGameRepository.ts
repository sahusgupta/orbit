import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { decodePrivateGameRecord } from '../../domain/decoders/playerBoundaryDecoders';
import type { PlayerPrivateGameListing } from '../../domain/playerSync';
import { db } from './firebaseClient';

function projectOpenPrivateGames(documents: Array<{ data(): unknown }>) {
  return documents
    .map((snapshot) => decodePrivateGameRecord(snapshot.data()))
    .filter((game) => game.status === 'Open')
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

export async function fetchPrivateGameListings() {
  try {
    const snapshots = await getDocs(openPrivateGamesQuery());
    return { ok: true as const, games: projectOpenPrivateGames(snapshots.docs) };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to read private games.' };
  }
}

export function subscribeToPrivateGameListings(
  callback: (result: { ok: true; games: PlayerPrivateGameListing[] } | { ok: false; error: string }) => void
) {
  return onSnapshot(
    openPrivateGamesQuery(),
    (snapshots) => callback({ ok: true, games: projectOpenPrivateGames(snapshots.docs) }),
    (error) => callback({ ok: false, error: error.message || 'Unable to subscribe to private games.' })
  );
}

function openPrivateGamesQuery() {
  return query(
    collection(db, 'privateGames'),
    where('status', '==', 'Open'),
    orderBy('createdAt', 'desc'),
    limit(100)
  );
}

export async function submitPrivateGameListing(listing: PlayerPrivateGameListing) {
  try {
    await setDoc(
      doc(db, 'privateGames', listing.id),
      {
        ...listing,
        updatedAt: serverTimestamp()
      },
      { merge: false }
    );
    return { ok: true as const, game: listing };
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Unable to list private game.' };
  }
}
