import { getAccountKeyFromState, safeAccountKeyPart } from '../../domain/licensing';
import type { AppState } from '../../domain/types';

export const maximumBrowserCheckpointBytes = 32 * 1024 * 1024;
export const maximumBrowserCheckpointJournalBytes = maximumBrowserCheckpointBytes + 64 * 1024;
export const maximumBrowserCheckpointAccounts = 8;

type EncryptedCheckpoint = {
  version: 1;
  token: string;
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

/** Implementations must commit mutations atomically, including capacity checks. */
export type BrowserCheckpointBackend = {
  getKey: () => Promise<CryptoKey | undefined>;
  ensureKey: (candidate: CryptoKey) => Promise<CryptoKey>;
  get: (accountRef: string) => Promise<EncryptedCheckpoint | undefined>;
  putIfAbsent: (accountRef: string, value: EncryptedCheckpoint) => Promise<EncryptedCheckpoint | undefined>;
  deleteIfToken: (accountRef: string, token: string) => Promise<boolean>;
};

export type PendingBrowserCheckpoint = {
  schemaVersion: 1;
  accountKey: string;
  mutationId: string;
  expectedRevision: number;
  createdAt: string;
  sourceHash: string;
  state: AppState;
};

type SecretSlot = {
  path: string[];
  kind: 'pilot' | 'login-salt' | 'login-hash' | 'staff-salt' | 'staff-hash' | 'check-in';
  identity: string;
};

type StoredCheckpoint = Omit<PendingBrowserCheckpoint, 'state'> & {
  credentialFingerprint: string;
  slots: SecretSlot[];
  state: Record<string, unknown>;
};

export class BrowserCheckpointJournalError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'BrowserCheckpointJournalError';
  }
}

const fail = (code: string, message: string): never => { throw new BrowserCheckpointJournalError(code, message); };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const encoder = new TextEncoder();
const restrictedField = /(?:authorization|password|credential|secret|privatekey|apikey|authkey|accesstoken|refreshtoken|bearer|pinsalt|pinhash|membershipqrtoken|capabilitygeneration)/i;
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const arrayFields = ['games', 'profiles', 'tournaments', 'interests', 'sessions', 'playerSessions', 'buyIns', 'dropLogs',
  'dealerAssignments', 'handCountLogs', 'timeFeeLogs', 'revenueTransactions', 'playerLedger', 'tableEvents',
  'inAppNotifications', 'staffRequests', 'history', 'nightCloses', 'feedback', 'scriptTemplates', 'correctionLog', 'usageEvents'];

function isCheckpointState(value: unknown): value is AppState {
  return isRecord(value) && arrayFields.every((field) => Array.isArray(value[field]))
    && isRecord(value.settings) && Array.isArray(value.settings.staffAccounts);
}

function secretSlots(state: AppState): SecretSlot[] {
  const slots: SecretSlot[] = [];
  const pilot = state.settings.pilotAccess;
  if (pilot) slots.push({ path: ['settings', 'pilotAccess', 'authorizationCode'], kind: 'pilot', identity: pilot.licenseId || '' });
  const login = state.settings.accountLogin;
  if (login) {
    slots.push({ path: ['settings', 'accountLogin', 'passwordSalt'], kind: 'login-salt', identity: login.username });
    slots.push({ path: ['settings', 'accountLogin', 'passwordHash'], kind: 'login-hash', identity: login.username });
  }
  const staffIds = new Set<string>();
  state.settings.staffAccounts.forEach((staff, index) => {
    if (!staff.id || staffIds.has(staff.id)) fail('BROWSER_CHECKPOINT_IDENTITY', 'Staff identities must be unique before preserving pending work.');
    staffIds.add(staff.id);
    slots.push({ path: ['settings', 'staffAccounts', String(index), 'pinSalt'], kind: 'staff-salt', identity: staff.id });
    slots.push({ path: ['settings', 'staffAccounts', String(index), 'pinHash'], kind: 'staff-hash', identity: staff.id });
  });
  if (state.selfCheckIn) slots.push({ path: ['selfCheckIn', 'capabilityGeneration'], kind: 'check-in', identity: '' });
  return slots;
}

function secretValue(state: AppState, slot: SecretSlot): string {
  let value: string | undefined;
  switch (slot.kind) {
    case 'pilot':
      if ((state.settings.pilotAccess?.licenseId || '') === slot.identity) value = state.settings.pilotAccess?.authorizationCode;
      break;
    case 'login-salt':
    case 'login-hash':
      if (state.settings.accountLogin?.username === slot.identity) {
        value = slot.kind === 'login-salt' ? state.settings.accountLogin.passwordSalt : state.settings.accountLogin.passwordHash;
      }
      break;
    case 'staff-salt':
    case 'staff-hash': {
      const staff = state.settings.staffAccounts.find((candidate) => candidate.id === slot.identity);
      value = slot.kind === 'staff-salt' ? staff?.pinSalt : staff?.pinHash;
      break;
    }
    case 'check-in': value = state.selfCheckIn?.capabilityGeneration; break;
  }
  if (typeof value !== 'string') return fail('BROWSER_CHECKPOINT_AUTH_CHANGED', 'Pending work is retained. Sign in to its original account or reconcile changed credentials before replay.');
  return value;
}

function setSlot(state: Record<string, unknown>, path: string[], value: string | null) {
  let node: unknown = state;
  for (const part of path.slice(0, -1)) {
    if (!isRecord(node) && !Array.isArray(node)) return fail('BROWSER_CHECKPOINT_INVALID', 'The pending checkpoint is invalid and has been retained.');
    node = Reflect.get(node, part);
  }
  if (!isRecord(node) && !Array.isArray(node)) return fail('BROWSER_CHECKPOINT_INVALID', 'The pending checkpoint is invalid and has been retained.');
  Reflect.set(node, path[path.length - 1], value);
}

function assertNoRestrictedFields(value: unknown, allowed: Set<string>, path: string[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRestrictedFields(item, allowed, [...path, String(index)]));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const nextPath = [...path, key];
      if (restrictedField.test(key) && !(allowed.has(JSON.stringify(nextPath)) && item === null)) {
        fail('BROWSER_CHECKPOINT_RESTRICTED', 'This change contains credential fields that require an online save. Pending work has not been replaced.');
      }
      assertNoRestrictedFields(item, allowed, nextPath);
    }
  }
}

const storedCheckpoint = (value: unknown): value is StoredCheckpoint => isRecord(value)
  && value.schemaVersion === 1 && typeof value.accountKey === 'string'
  && typeof value.mutationId === 'string' && /^[a-zA-Z0-9._:-]{1,180}$/.test(value.mutationId)
  && Number.isSafeInteger(value.expectedRevision) && Number(value.expectedRevision) >= 0
  && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt))
  && typeof value.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(value.sourceHash)
  && typeof value.credentialFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.credentialFingerprint)
  && isRecord(value.state) && Array.isArray(value.slots) && value.slots.every((slot: unknown) =>
    isRecord(slot) && Array.isArray(slot.path) && slot.path.length > 0 && slot.path.every((part: unknown) => typeof part === 'string')
    && typeof slot.identity === 'string' && ['pilot', 'login-salt', 'login-hash', 'staff-salt', 'staff-hash', 'check-in'].includes(String(slot.kind)));

function createIndexedDbBackend(factory: IDBFactory, databaseName: string): BrowserCheckpointBackend {
  let opened: Promise<IDBDatabase> | undefined;
  const open = () => opened ??= new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('keys');
      request.result.createObjectStore('pending');
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); opened = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { opened = undefined; reject(request.error); };
    request.onblocked = () => reject(new Error('Close other Orbit tabs before opening the pending-work journal.'));
  });
  const run = async <T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore, finish: (value: T) => void, abort: (error: Error) => void) => void): Promise<T> => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      let result: T;
      let failure: Error | null = null;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure || transaction.error || new Error('Pending work could not be durably stored.'));
      transaction.onerror = () => { /* The abort handler reports the durable failure. */ };
      try {
        action(transaction.objectStore(storeName), (value) => { result = value; }, (error) => { failure = error; transaction.abort(); });
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Pending work could not be durably stored.');
        transaction.abort();
      }
    });
  };
  return {
    getKey: () => run('keys', 'readonly', (store, finish) => {
      const request = store.get('encryption');
      request.onsuccess = () => finish(request.result);
    }),
    ensureKey: (candidate) => run('keys', 'readwrite', (store, finish) => {
      const request = store.get('encryption');
      request.onsuccess = () => {
        if (request.result) finish(request.result);
        else { store.add(candidate, 'encryption'); finish(candidate); }
      };
    }),
    get: (accountRef) => run('pending', 'readonly', (store, finish) => {
      const request = store.get(accountRef);
      request.onsuccess = () => finish(request.result);
    }),
    putIfAbsent: (accountRef, value) => run('pending', 'readwrite', (store, finish, abort) => {
      const request = store.get(accountRef);
      request.onsuccess = () => {
        if (request.result) { finish(request.result); return; }
        let totalBytes = value.ciphertext.byteLength + value.iv.byteLength;
        let count = 1;
        const cursor = store.openCursor();
        cursor.onsuccess = () => {
          if (cursor.result) {
            const retained: EncryptedCheckpoint = cursor.result.value;
            totalBytes += retained.ciphertext.byteLength + retained.iv.byteLength;
            count += 1;
            cursor.result.continue();
          } else if (totalBytes > maximumBrowserCheckpointJournalBytes || count > maximumBrowserCheckpointAccounts) {
            abort(new BrowserCheckpointJournalError('BROWSER_CHECKPOINT_CAPACITY', 'Pending-work storage is full. Reconnect and resolve retained work before accepting this change.'));
          } else { store.add(value, accountRef); finish(undefined); }
        };
      };
    }),
    deleteIfToken: (accountRef, token) => run('pending', 'readwrite', (store, finish) => {
      const request = store.get(accountRef);
      request.onsuccess = () => {
        if (request.result?.token !== token) { finish(false); return; }
        store.delete(accountRef);
        finish(true);
      };
    })
  };
}

/** A journal acknowledgement means local durability only; it never means server confirmation. */
export function createBrowserCheckpointJournal(options: {
  backend?: BrowserCheckpointBackend;
  crypto?: Crypto;
  indexedDB?: IDBFactory;
  databaseName?: string;
  now?: () => Date;
} = {}) {
  const webCrypto = options.crypto || globalThis.crypto;
  const factory = options.indexedDB || globalThis.indexedDB;
  const backend = options.backend || (factory ? createIndexedDbBackend(factory, options.databaseName || 'orbit-pending-checkpoints-v1') : undefined);
  const now = options.now || (() => new Date());
  const requireBackend = () => backend || fail('BROWSER_CHECKPOINT_UNAVAILABLE', 'Durable browser storage is unavailable. Keep this tab open and reconnect before accepting this change.');
  const digest = async (value: string) => {
    if (!webCrypto?.subtle) fail('BROWSER_CHECKPOINT_UNAVAILABLE', 'Secure browser storage is unavailable. Reconnect before accepting this change.');
    return hex(await webCrypto.subtle.digest('SHA-256', encoder.encode(value)));
  };
  const accountRef = (state: AppState) => digest(getAccountKeyFromState(state));
  const fingerprint = (state: AppState, slots: SecretSlot[]) => digest(JSON.stringify(slots.map((slot) => [slot.kind, slot.identity, secretValue(state, slot)])));
  const read = async (encrypted: EncryptedCheckpoint, state: AppState, reference: string): Promise<PendingBrowserCheckpoint> => {
    const key = await requireBackend().getKey();
    if (!key || key.extractable || key.algorithm.name !== 'AES-GCM') return fail('BROWSER_CHECKPOINT_KEY_UNAVAILABLE', 'Pending work is retained, but its protected storage key is unavailable.');
    let decoded: unknown;
    try {
      const plaintext = await webCrypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.iv, additionalData: encoder.encode(reference) }, key, encrypted.ciphertext);
      decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    } catch { return fail('BROWSER_CHECKPOINT_INVALID', 'The pending checkpoint could not be verified and has been retained.'); }
    if (!storedCheckpoint(decoded) || decoded.accountKey !== getAccountKeyFromState(state)) return fail('BROWSER_CHECKPOINT_INVALID', 'The pending checkpoint is invalid and has been retained.');
    if (await fingerprint(state, decoded.slots) !== decoded.credentialFingerprint) return fail('BROWSER_CHECKPOINT_AUTH_CHANGED', 'Pending work is retained. Sign in with its original account credentials before replay.');
    const allowed = new Set(decoded.slots.map((slot) => JSON.stringify(slot.path)));
    assertNoRestrictedFields(decoded.state, allowed);
    decoded.slots.forEach((slot) => setSlot(decoded.state, slot.path, secretValue(state, slot)));
    if (!isCheckpointState(decoded.state) || await digest(JSON.stringify(decoded.state)) !== decoded.sourceHash) return fail('BROWSER_CHECKPOINT_AUTH_CHANGED', 'Pending work is retained. Its original credential context must be reconciled before replay.');
    return { schemaVersion: 1, accountKey: decoded.accountKey, mutationId: decoded.mutationId,
      expectedRevision: decoded.expectedRevision, createdAt: decoded.createdAt, sourceHash: decoded.sourceHash, state: decoded.state };
  };
  return {
    async hasPending(accountKey: string): Promise<boolean> {
      return Boolean(await requireBackend().get(await digest(accountKey)));
    },
    async store(input: { state: AppState; mutationId: string; expectedRevision: number; previousState?: AppState }): Promise<PendingBrowserCheckpoint> {
      if (!/^[a-zA-Z0-9._:-]{1,180}$/.test(input.mutationId) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) return fail('BROWSER_CHECKPOINT_INVALID', 'A stable operation ID and non-negative revision are required.');
      const authorizationCode = input.state.settings.pilotAccess?.authorizationCode;
      if (authorizationCode && getAccountKeyFromState(input.state) === safeAccountKeyPart(authorizationCode)) {
        return fail('BROWSER_CHECKPOINT_CREDENTIAL_CHANGE', 'This legacy account derives its identity from a credential. Durable browser recovery requires a stable account identity; this save needs online confirmation.');
      }
      const sourceJson = JSON.stringify(input.state);
      if (encoder.encode(sourceJson).byteLength > maximumBrowserCheckpointBytes) return fail('BROWSER_CHECKPOINT_CAPACITY', 'This checkpoint exceeds the local recovery budget. Existing pending work has been retained.');
      const slots = secretSlots(input.state);
      const credentialFingerprint = await fingerprint(input.state, slots);
      if (input.previousState && (getAccountKeyFromState(input.previousState) !== getAccountKeyFromState(input.state)
        || await fingerprint(input.previousState, secretSlots(input.previousState)) !== credentialFingerprint)) return fail('BROWSER_CHECKPOINT_CREDENTIAL_CHANGE', 'Credential changes require an online save before they can be confirmed.');
      const projection: unknown = JSON.parse(sourceJson);
      if (!isRecord(projection)) return fail('BROWSER_CHECKPOINT_INVALID', 'A management state is required.');
      slots.forEach((slot) => setSlot(projection, slot.path, null));
      assertNoRestrictedFields(projection, new Set(slots.map((slot) => JSON.stringify(slot.path))));
      const reference = await accountRef(input.state);
      const pending: StoredCheckpoint = { schemaVersion: 1, accountKey: getAccountKeyFromState(input.state),
        mutationId: input.mutationId, expectedRevision: input.expectedRevision, createdAt: now().toISOString(),
        sourceHash: await digest(sourceJson), credentialFingerprint, slots, state: projection };
      const retained = await requireBackend().get(reference);
      if (retained) {
        const existing = await read(retained, input.state, reference);
        if (existing.mutationId === input.mutationId && existing.expectedRevision === input.expectedRevision && existing.sourceHash === pending.sourceHash) return existing;
        return fail('BROWSER_CHECKPOINT_PENDING', 'An earlier change is still pending. Reconnect and resolve it before replacing its recovery record.');
      }
      const candidateKey = await webCrypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const key = await requireBackend().ensureKey(candidateKey);
      if (key.extractable || key.algorithm.name !== 'AES-GCM') return fail('BROWSER_CHECKPOINT_KEY_UNAVAILABLE', 'Secure browser storage is unavailable.');
      const iv = webCrypto.getRandomValues(new Uint8Array(12));
      const plaintext = encoder.encode(JSON.stringify(pending));
      if (plaintext.byteLength > maximumBrowserCheckpointJournalBytes - 28) return fail('BROWSER_CHECKPOINT_CAPACITY', 'This checkpoint exceeds the local recovery budget. Existing pending work has been retained.');
      const ciphertext = await webCrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(reference) }, key, plaintext);
      const encrypted: EncryptedCheckpoint = { version: 1, token: webCrypto.randomUUID(), iv: iv.buffer, ciphertext };
      const raced = await requireBackend().putIfAbsent(reference, encrypted);
      const result = await read(raced || encrypted, input.state, reference);
      if (result.mutationId !== input.mutationId || result.expectedRevision !== input.expectedRevision || result.sourceHash !== pending.sourceHash) return fail('BROWSER_CHECKPOINT_PENDING', 'An earlier change is still pending. Reconnect and resolve it before replacing its recovery record.');
      return result;
    },
    async load(authenticatedState: AppState): Promise<PendingBrowserCheckpoint | null> {
      const reference = await accountRef(authenticatedState);
      const encrypted = await requireBackend().get(reference);
      return encrypted ? read(encrypted, authenticatedState, reference) : null;
    },
    async acknowledge(authenticatedState: AppState, mutationId: string): Promise<boolean> {
      const reference = await accountRef(authenticatedState);
      const encrypted = await requireBackend().get(reference);
      if (!encrypted) return false;
      const pending = await read(encrypted, authenticatedState, reference);
      if (pending.mutationId !== mutationId) return false;
      return requireBackend().deleteIfToken(reference, encrypted.token);
    }
  };
}
