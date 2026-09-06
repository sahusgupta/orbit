import type { PlayerAccount } from '../../domain/playerSync';
import { e164PhoneRequirement, normalizeE164Phone } from '../../domain/playerPhone';

export const legacyPlayerStorageKeys = ['tabletalk-player-account-v1', 'tabletalk-player-account-v2'];
export const playerStorageKey = 'orbit-player-account-v1';
export const dismissedAlertsStorageKey = 'orbit-player-dismissed-alerts-v1';
export const pendingPlayerProfileStorageKey = 'orbit-player-pending-profile-v1';
export const pendingPlayerAuthCleanupStorageKey = 'orbit-player-pending-auth-cleanup-v1';
const allPlayerStorageKeys = [playerStorageKey, ...legacyPlayerStorageKeys, dismissedAlertsStorageKey, pendingPlayerProfileStorageKey];

type StorageEntry = readonly [string, string | null];

export type PlayerStoragePort = {
  getItem(key: string): Promise<string | null>;
  multiGet(keys: string[]): Promise<readonly StorageEntry[]>;
  multiRemove(keys: string[]): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
};

export type StoredPlayerResult =
  | { kind: 'restored'; player: PlayerAccount }
  | { kind: 'missing' }
  | { kind: 'invalid' };

export type PendingPlayerProfile = {
  player: PlayerAccount;
  uid: string;
  version: string;
};

function decodePendingPlayerAuthCleanupUid(stored: string | null) {
  if (!stored) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored) as unknown;
  } catch {
    throw new Error('The pending secure sign-out record is invalid.');
  }
  const uid = (parsed as { uid?: unknown } | null)?.uid;
  if (typeof uid !== 'string' || !uid || uid.trim() !== uid || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) {
    throw new Error('The pending secure sign-out record is invalid.');
  }
  return uid;
}

type PendingPlayerProfileJournal = Record<string, PendingPlayerProfile>;

function normalizeStoredPlayer(candidate: unknown, emptyPlayer: PlayerAccount): PlayerAccount | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const parsed = candidate as Partial<PlayerAccount>;
  const hasEmail = Boolean(parsed.email?.trim());
  const hasPhoneIdentity = parsed.email === ''
    && typeof parsed.phone === 'string'
    && normalizeE164Phone(parsed.phone) === parsed.phone;
  if (!parsed.name?.trim() || (!hasEmail && !hasPhoneIdentity)) return null;
  return {
    ...emptyPlayer,
    ...parsed,
    preferredGameIds: Array.isArray(parsed.preferredGameIds) && parsed.preferredGameIds.every((value) => typeof value === 'string')
      ? parsed.preferredGameIds
      : [],
    favoriteClubIds: Array.isArray(parsed.favoriteClubIds) && parsed.favoriteClubIds.every((value) => typeof value === 'string')
      ? parsed.favoriteClubIds
      : []
  };
}

function decodePendingPlayerProfile(
  candidate: unknown,
  expectedUid: string,
  emptyPlayer: PlayerAccount
): PendingPlayerProfile | null {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const parsed = candidate as Partial<PendingPlayerProfile>;
  const player = normalizeStoredPlayer(parsed.player, emptyPlayer);
  if (
    parsed.uid !== expectedUid ||
    typeof parsed.version !== 'string' || !parsed.version ||
    !player || player.id !== expectedUid
  ) return null;
  return { uid: expectedUid, version: parsed.version, player };
}

function parsePendingPlayerProfileJournal(stored: string | null): Record<string, unknown> {
  if (!stored) return {};
  try {
    const parsed = JSON.parse(stored) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    // Read the first journal shape conservatively so an interrupted upgrade does
    // not discard an already-persisted edit.
    if (typeof record.uid === 'string' && record.player && record.version) {
      return { [record.uid]: record };
    }
    return record;
  } catch {
    return {};
  }
}

export function createPlayerStorage(storage: PlayerStoragePort) {
  let writeGeneration = 0;
  let clearInFlight = false;
  let mutationTail = Promise.resolve();

  const sequenceMutation = <Result,>(operation: () => Promise<Result>) => {
    const task = mutationTail.then(operation);
    mutationTail = task.then(() => undefined, () => undefined);
    return task;
  };

  const sequenceWrite = (operation: () => Promise<void>) => {
    if (clearInFlight) return Promise.resolve();
    const generation = writeGeneration;
    return sequenceMutation(async () => {
      if (clearInFlight || generation !== writeGeneration) return;
      await operation();
    });
  };

  const sequenceRequiredWrite = (operation: () => Promise<void>) => {
    if (clearInFlight) return Promise.reject(new Error('The profile save was retired by local account cleanup.'));
    const generation = writeGeneration;
    return sequenceMutation(async () => {
      if (clearInFlight || generation !== writeGeneration) {
        throw new Error('The profile save was retired by local account cleanup.');
      }
      await operation();
    });
  };

  return {
    async loadPendingPlayerAuthCleanupUid() {
      return decodePendingPlayerAuthCleanupUid(await storage.getItem(pendingPlayerAuthCleanupStorageKey));
    },

    savePendingPlayerAuthCleanupUid(uid: string) {
      if (!uid || uid.trim() !== uid || uid.length > 128 || /[\u0000-\u001f\u007f]/.test(uid)) {
        return Promise.reject(new Error('A valid account is required for secure sign-out cleanup.'));
      }
      return sequenceRequiredWrite(() => storage.setItem(
        pendingPlayerAuthCleanupStorageKey,
        JSON.stringify({ uid })
      ));
    },

    clearPendingPlayerAuthCleanupUid(expectedUid: string) {
      return sequenceWrite(async () => {
        const stored = await storage.getItem(pendingPlayerAuthCleanupStorageKey);
        if (decodePendingPlayerAuthCleanupUid(stored) !== expectedUid) return;
        await storage.multiRemove([pendingPlayerAuthCleanupStorageKey]);
      });
    },

    async loadPlayer(emptyPlayer: PlayerAccount): Promise<StoredPlayerResult> {
      const entries = await storage.multiGet([playerStorageKey, ...legacyPlayerStorageKeys]);
      const stored = entries.find(([, value]) => Boolean(value))?.[1];
      if (!stored) return { kind: 'missing' };
      let parsed: unknown;
      try {
        parsed = JSON.parse(stored) as unknown;
      } catch {
        await storage.multiRemove(allPlayerStorageKeys);
        return { kind: 'invalid' };
      }
      const player = normalizeStoredPlayer(parsed, emptyPlayer);
      if (!player) {
        await storage.multiRemove(allPlayerStorageKeys);
        return { kind: 'invalid' };
      }
      return { kind: 'restored', player };
    },

    savePlayer(player: PlayerAccount) {
      const phoneInput = player.phone?.trim() ?? '';
      const normalizedPhone = normalizeE164Phone(phoneInput);
      if (phoneInput && !normalizedPhone) {
        return Promise.reject(new Error(`Phone number was not saved. ${e164PhoneRequirement}`));
      }
      const persistedPlayer = normalizedPhone && normalizedPhone !== player.phone
        ? { ...player, phone: normalizedPhone }
        : player;
      return sequenceWrite(() => storage.setItem(playerStorageKey, JSON.stringify(persistedPlayer)));
    },

    async loadDismissedAlertIds(): Promise<string[]> {
      const stored = await storage.getItem(dismissedAlertsStorageKey);
      if (!stored) return [];
      try {
        const parsed = JSON.parse(stored) as unknown;
        if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) return parsed;
      } catch {
        // Invalid dismissal data is cleared below with the same recoverable path.
      }
      await storage.multiRemove([dismissedAlertsStorageKey]);
      return [];
    },

    saveDismissedAlertIds(notificationIds: string[]) {
      return sequenceWrite(() => storage.setItem(dismissedAlertsStorageKey, JSON.stringify(notificationIds)));
    },

    async loadPendingPlayerProfile(expectedUid: string, emptyPlayer: PlayerAccount): Promise<PendingPlayerProfile | null> {
      const stored = await storage.getItem(pendingPlayerProfileStorageKey);
      if (!stored) return null;
      const journal = parsePendingPlayerProfileJournal(stored);
      return decodePendingPlayerProfile(journal[expectedUid], expectedUid, emptyPlayer);
    },

    savePendingPlayerProfile(pending: PendingPlayerProfile) {
      if (!pending.uid.trim() || pending.player.id !== pending.uid || !pending.version) {
        return Promise.reject(new Error('Pending profile changes must belong to the signed-in account.'));
      }
      return sequenceRequiredWrite(async () => {
        const journal = parsePendingPlayerProfileJournal(await storage.getItem(pendingPlayerProfileStorageKey));
        const nextJournal: PendingPlayerProfileJournal = {
          ...journal as PendingPlayerProfileJournal,
          [pending.uid]: pending
        };
        await storage.setItem(pendingPlayerProfileStorageKey, JSON.stringify(nextJournal));
      });
    },

    clearPendingPlayerProfile(uid: string, version: string) {
      return sequenceWrite(async () => {
        const stored = await storage.getItem(pendingPlayerProfileStorageKey);
        if (!stored) return;
        const journal = parsePendingPlayerProfileJournal(stored);
        const pending = journal[uid] as Partial<PendingPlayerProfile> | undefined;
        if (pending?.uid !== uid || pending.version !== version) return;
        const nextJournal = { ...journal };
        delete nextJournal[uid];
        if (Object.keys(nextJournal).length) {
          await storage.setItem(pendingPlayerProfileStorageKey, JSON.stringify(nextJournal));
        } else {
          await storage.multiRemove([pendingPlayerProfileStorageKey]);
        }
      });
    },

    clearPlayer() {
      writeGeneration += 1;
      const clearGeneration = writeGeneration;
      clearInFlight = true;
      const task = sequenceMutation(() => storage.multiRemove(allPlayerStorageKeys));
      return task.finally(() => {
        if (writeGeneration === clearGeneration) clearInFlight = false;
      });
    }
  };
}
