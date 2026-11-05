import { describe, expect, it, vi } from 'vitest';
import { seedState } from '../../domain/state';
import type { AppState } from '../../domain/types';
import {
  createBrowserCheckpointJournal,
  maximumBrowserCheckpointAccounts,
  maximumBrowserCheckpointBytes,
  maximumBrowserCheckpointJournalBytes,
  type BrowserCheckpointBackend
} from './browserCheckpointJournal';

type EncryptedRecord = NonNullable<Awaited<ReturnType<BrowserCheckpointBackend['get']>>>;

// This adapter represents an atomic durable store shared across process objects.
// The production IndexedDB adapter requires separate real-browser verification.
function durableFixture() {
  const records = new Map<string, EncryptedRecord>();
  let key: CryptoKey | undefined;
  let failWrite = false;
  const backend: BrowserCheckpointBackend = {
    getKey: async () => key,
    ensureKey: async (candidate) => key ??= candidate,
    get: async (accountRef) => records.get(accountRef),
    putIfAbsent: async (accountRef, value) => {
      if (failWrite) throw new DOMException('Synthetic storage quota exhausted.', 'QuotaExceededError');
      const existing = records.get(accountRef);
      if (existing) return existing;
      const bytes = [...records.values()].reduce((sum, item) => sum + item.ciphertext.byteLength + item.iv.byteLength, value.ciphertext.byteLength + value.iv.byteLength);
      if (records.size >= maximumBrowserCheckpointAccounts || bytes > maximumBrowserCheckpointJournalBytes) throw new Error('Synthetic capacity exceeded.');
      records.set(accountRef, value);
      return undefined;
    },
    deleteIfToken: async (accountRef, token) => {
      if (records.get(accountRef)?.token !== token) return false;
      return records.delete(accountRef);
    }
  };
  return { backend, records, getKey: () => key, setFailWrite: (value: boolean) => { failWrite = value; } };
}

const baseState = (): AppState => ({
  ...structuredClone(seedState),
  settings: {
    ...structuredClone(seedState.settings),
    pilotAccess: { authorized: true, licenseId: 'synthetic-journal', authorizationCode: 'synthetic-pilot-secret',
      activatedAt: '2026-11-03T12:00:00.000Z', expiresAt: '2099-01-01' },
    accountLogin: { username: 'journal@example.test', passwordSalt: 'synthetic-login-salt',
      passwordHash: 'synthetic-login-verifier', createdAt: '2026-11-03T12:00:00.000Z' },
    staffAccounts: [{ id: 'staff-one', name: 'Synthetic Staff', role: 'Manager', pinSalt: 'synthetic-pin-salt',
      pinHash: 'synthetic-pin-verifier', active: true, createdAt: '2026-11-03T12:00:00.000Z' }]
  },
  selfCheckIn: { capabilityGeneration: 'synthetic-check-in-secret', generatedAt: '2026-11-03T12:00:00.000Z' }
});

const operation = (state = baseState(), mutationId = 'browser:operation-one') => ({ state, mutationId, expectedRevision: 7 });

describe('encrypted browser checkpoint journal', () => {
  it('keeps credential-derived legacy tenant identities out of durable state and embedded usage records', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    const state = baseState();
    if (state.settings.pilotAccess) delete state.settings.pilotAccess.licenseId;
    state.usageEvents = [{ id: 'legacy-event', accountKey: 'synthetic-pilot-secret', feature: 'floor', action: 'Check in', route: 'floor', timestamp: '2026-11-03T12:00:00.000Z' }];
    await expect(journal.store(operation(state))).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_CREDENTIAL_CHANGE' });
    expect(durable.records.size).toBe(0);
    expect(durable.getKey()).toBeUndefined();
  });
  it('restores an oversized UTF-8 operational snapshot after journal recreation and excludes credentials even from decrypted storage', async () => {
    const durable = durableFixture();
    const state = baseState();
    state.scriptTemplates = ['♠ operational history '.repeat(120_000)];
    expect(new TextEncoder().encode(JSON.stringify(state)).byteLength).toBeGreaterThan(2_000_000);
    const first = createBrowserCheckpointJournal({ backend: durable.backend });
    const pending = await first.store(operation(state));
    const encrypted = [...durable.records.values()][0];
    const key = durable.getKey();
    expect(key?.extractable).toBe(false);
    expect(key).toBeDefined();
    if (!key) throw new Error('Expected fixture key.');
    await expect(crypto.subtle.exportKey('raw', key)).rejects.toThrow();
    const reference = [...durable.records.keys()][0];
    const plaintext = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.iv,
      additionalData: new TextEncoder().encode(reference) }, key, encrypted.ciphertext));
    for (const restricted of ['synthetic-pilot-secret', 'synthetic-login-salt', 'synthetic-login-verifier',
      'synthetic-pin-salt', 'synthetic-pin-verifier', 'synthetic-check-in-secret']) expect(plaintext).not.toContain(restricted);
    expect(plaintext).toContain('operational history');
    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('operational history');
    const afterRestart = createBrowserCheckpointJournal({ backend: durable.backend });
    expect(await afterRestart.hasPending('synthetic-journal')).toBe(true);
    expect(await afterRestart.hasPending('different-tenant')).toBe(false);
    const restored = await afterRestart.load(baseState());
    expect(restored).toEqual(pending);
    expect(restored?.state).toEqual(state);
    expect(JSON.stringify(restored?.state)).toBe(JSON.stringify(state));
    expect(state.settings.pilotAccess?.authorizationCode).toBe('synthetic-pilot-secret');
    expect(await afterRestart.acknowledge(baseState(), pending.mutationId)).toBe(true);
    expect(await first.load(baseState())).toBeNull();
    expect(await afterRestart.hasPending('synthetic-journal')).toBe(false);
  });

  it('retains stable mutation identity and never replaces unresolved state, including concurrent tabs', async () => {
    const durable = durableFixture();
    const first = createBrowserCheckpointJournal({ backend: durable.backend });
    const otherTab = createBrowserCheckpointJournal({ backend: durable.backend });
    const outcomes = await Promise.allSettled([first.store(operation()), otherTab.store(operation())]);
    expect(outcomes.every((result) => result.status === 'fulfilled')).toBe(true);
    const retained = await first.load(baseState());
    expect(retained).toMatchObject({ expectedRevision: 7, mutationId: 'browser:operation-one' });
    expect(durable.records.size).toBe(1);
    const changed = baseState();
    changed.scriptTemplates.push('Later local work');
    await expect(otherTab.store(operation(changed, 'browser:operation-two'))).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_PENDING' });
    expect(await first.load(baseState())).toEqual(retained);
    expect(await otherTab.acknowledge(baseState(), 'unrelated-response')).toBe(false);
    expect(await first.load(baseState())).toEqual(retained);
  });

  it('separates tenants and retains work after credential rotation, tampering, or missing encryption key', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    await journal.store(operation());
    const differentTenant = baseState();
    if (differentTenant.settings.pilotAccess) differentTenant.settings.pilotAccess.licenseId = 'different-tenant';
    expect(await journal.load(differentTenant)).toBeNull();
    expect(await journal.acknowledge(differentTenant, 'browser:operation-one')).toBe(false);
    const rotated = baseState();
    if (rotated.settings.accountLogin) rotated.settings.accountLogin.passwordHash = 'new-verifier';
    await expect(journal.load(rotated)).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_AUTH_CHANGED' });
    expect(durable.records.size).toBe(1);
    const noKey = createBrowserCheckpointJournal({ backend: { ...durable.backend, getKey: async () => undefined } });
    await expect(noKey.load(baseState())).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_KEY_UNAVAILABLE' });
    const encrypted = [...durable.records.values()][0];
    new Uint8Array(encrypted.ciphertext)[0] ^= 1;
    await expect(journal.load(baseState())).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_INVALID' });
    expect(durable.records.size).toBe(1);
  });

  it('rejects unknown restricted fields and credential mutations without pruning operational metadata', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    const changed = baseState();
    if (changed.settings.accountLogin) changed.settings.accountLogin.passwordHash = 'changed';
    await expect(journal.store({ ...operation(changed), previousState: baseState() }))
      .rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_CREDENTIAL_CHANGE' });
    const removedStaff = baseState();
    removedStaff.settings.staffAccounts = [];
    await expect(journal.store({ ...operation(removedStaff), previousState: baseState() }))
      .rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_CREDENTIAL_CHANGE' });
    const unexpected = { ...baseState(), transportCredential: 'synthetic-unrecognized-secret' };
    await expect(journal.store(operation(unexpected))).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_RESTRICTED' });
    const normal = baseState();
    normal.usageEvents = [{ id: 'event-one', feature: 'floor', action: 'Check in', route: 'floor', timestamp: '2026-11-03T12:00:00.000Z',
      accountKey: 'synthetic-journal', metadata: { note: 'Preserve arbitrary operational metadata', count: 3 } }];
    expect((await journal.store(operation(normal))).state).toEqual(normal);
    expect(durable.records.size).toBe(1);
  });

  it('never claims durable enqueue on quota/write failure and leaves the previous snapshot available', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    durable.setFailWrite(true);
    await expect(journal.store(operation())).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(await journal.load(baseState())).toBeNull();
    durable.setFailWrite(false);
    await journal.store(operation());
    const before = await journal.load(baseState());
    durable.setFailWrite(true);
    await expect(journal.store(operation(baseState(), 'later-operation'))).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_PENDING' });
    expect(await journal.load(baseState())).toEqual(before);
  });

  it('bounds multibyte source bytes and rejects malformed mutation envelopes', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    const oversized = baseState();
    oversized.scriptTemplates = ['♠'.repeat(Math.ceil(maximumBrowserCheckpointBytes / 3))];
    await expect(journal.store(operation(oversized))).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_CAPACITY' });
    await expect(journal.store({ ...operation(), expectedRevision: -1 })).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_INVALID' });
    await expect(journal.store({ ...operation(), mutationId: 'unsafe/id' })).rejects.toMatchObject({ code: 'BROWSER_CHECKPOINT_INVALID' });
    expect(durable.records.size).toBe(0);
  });

  it('uses compare-and-delete so a late acknowledgement cannot erase a newer record', async () => {
    const durable = durableFixture();
    const journal = createBrowserCheckpointJournal({ backend: durable.backend });
    await journal.store(operation());
    const originalDelete = durable.backend.deleteIfToken;
    durable.backend.deleteIfToken = vi.fn(async (accountRef, token) => {
      const previous = durable.records.get(accountRef);
      if (!previous) throw new Error('Expected pending record.');
      durable.records.set(accountRef, { ...previous, token: 'newer-record-token' });
      return originalDelete(accountRef, token);
    });
    expect(await journal.acknowledge(baseState(), 'browser:operation-one')).toBe(false);
    expect(durable.records.size).toBe(1);
  });
});
