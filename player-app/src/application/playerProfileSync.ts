import type { PlayerAccount } from '../domain/playerSync';
import { createSecureUuid } from '../security/secureIdentifier';
import type { PendingPlayerProfile } from '../data/storage/playerStorageCore';

export type PendingProfileSyncResult =
  | { kind: 'saved' }
  | { kind: 'failed'; error: unknown; stage: 'local-persistence' | 'remote' | 'local-acknowledgement' }
  | { kind: 'retired' };

export function createPendingProfileVersion() {
  return createSecureUuid();
}

export async function syncPendingPlayerProfile(
  pending: PendingPlayerProfile,
  ports: {
    clearPending(uid: string, version: string): Promise<void>;
    currentUid(): string | null;
    pendingPersisted: Promise<void>;
    saveRemote(player: PlayerAccount, uid: string): Promise<unknown>;
  }
): Promise<PendingProfileSyncResult> {
  try {
    await ports.pendingPersisted;
  } catch (error) {
    return ports.currentUid() === pending.uid
      ? { kind: 'failed', error, stage: 'local-persistence' }
      : { kind: 'retired' };
  }
  if (ports.currentUid() !== pending.uid) return { kind: 'retired' };
  try {
    await ports.saveRemote(pending.player, pending.uid);
  } catch (error) {
    return ports.currentUid() === pending.uid
      ? { kind: 'failed', error, stage: 'remote' }
      : { kind: 'retired' };
  }
  if (ports.currentUid() !== pending.uid) return { kind: 'retired' };
  try {
    await ports.clearPending(pending.uid, pending.version);
  } catch (error) {
    return ports.currentUid() === pending.uid
      ? { kind: 'failed', error, stage: 'local-acknowledgement' }
      : { kind: 'retired' };
  }
  if (ports.currentUid() !== pending.uid) return { kind: 'retired' };
  return { kind: 'saved' };
}
