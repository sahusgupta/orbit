import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import database from './database.js';
import connection from './db/connection';

const {
  closeDatabase,
  claimManagementRecoveryOverride,
  consumeManagementRecoveryOverride,
  createManagementRecoveryOverride,
  getClient,
  getDatabaseStatus,
  getTelemetrySummary,
  getManagementRecoveryOverride,
  listClientErrors,
  listClients,
  listClientUpdateEvents,
  listTelemetryEvents,
  listManagementRecoveryOverrides,
  listManagementSecurityEvents,
  listStatePage,
  listVenues,
  loadLatestState,
  loadState,
  recordClientError,
  recordTelemetryEvent,
  recordManagementSecurityEvent,
  recordUpdateEvent,
  releaseManagementRecoveryClaim,
  revokeManagementRecoveryOverride,
  saveState,
  storeAnalyticalReport,
  upsertClient
} = database;

function makeState(overrides = {}) {
  return {
    games: [],
    sessions: [],
    playerSessions: [],
    profiles: [{ id: 'profile-1', name: 'Ada Lovelace', membershipStatus: 'Active' }],
    settings: {
      clubAccount: {
        clubName: 'Character Club',
        email: 'Owner@Example.com'
      }
    },
    ...overrides
  };
}

const clientPayload = {
  deviceId: 'device-1',
  venueId: 'Character Club',
  venueName: 'Character Club',
  deviceName: 'Front Desk',
  appVersion: '1.2.3',
  platform: 'win32',
  environment: 'test',
  lastSeenAt: '2026-08-07T12:00:00.000Z',
  updateStatus: 'ready',
  updateEvent: 'update-ready',
  currentUser: { id: 'staff-1', name: 'Grace' }
};

afterAll(async () => {
  await closeDatabase();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('API database facade behavior', () => {
  it('keeps recovery overrides durable, expiring, claimable, and single-use', async () => {
    const now = new Date('2026-08-11T15:00:00.000Z');
    const created = await createManagementRecoveryOverride({
      accountKey: 'Room One',
      durationMinutes: 15,
      reason: 'Founder-approved support recovery',
      createdByRef: 'actor-ref',
      now
    });
    expect(created).toMatchObject({ accountKey: 'room-one', status: 'active', reason: 'Founder-approved support recovery' });
    expect(await getManagementRecoveryOverride('room-one', { activeOnly: true, now })).toMatchObject({ id: created.id });

    const claimed = await claimManagementRecoveryOverride('room-one', { now: new Date('2026-08-11T15:01:00.000Z') });
    expect(claimed).toMatchObject({ id: created.id, status: 'processing' });
    expect(await claimManagementRecoveryOverride('room-one', { now: new Date('2026-08-11T15:01:01.000Z') })).toBeNull();

    await releaseManagementRecoveryClaim(created.id, { now: new Date('2026-08-11T15:02:00.000Z') });
    expect(await claimManagementRecoveryOverride('room-one', { now: new Date('2026-08-11T15:03:00.000Z') })).toMatchObject({ id: created.id });
    expect(await consumeManagementRecoveryOverride(created.id, { now: new Date('2026-08-11T15:04:00.000Z') })).toBe(true);
    expect(await getManagementRecoveryOverride('room-one', { activeOnly: true, now: new Date('2026-08-11T15:04:01.000Z') })).toBeNull();
    expect(await listManagementRecoveryOverrides({ now: new Date('2026-08-11T15:04:01.000Z') })).toEqual([
      expect.objectContaining({ id: created.id, status: 'consumed' })
    ]);
    expect(await revokeManagementRecoveryOverride('room-one', { now: new Date('2026-08-11T15:05:00.000Z') })).toBe(false);
  });

  it('stores a durable redacted management security history without credentials', async () => {
    const secretSentinel = ['must', 'not', 'be', 'stored'].join('-');
    const tokenSentinel = `${secretSentinel}-${'x'.repeat(8)}`;
    const event = await recordManagementSecurityEvent({
      accountKey: 'Room One',
      event: 'management-password-changed',
      actorRef: 'dashboard:actor-ref',
      details: {
        revision: 7,
        password: secretSentinel,
        token: tokenSentinel
      },
      occurredAt: '2026-08-11T15:06:00.000Z'
    });
    expect(event).toMatchObject({
      accountKey: 'room-one',
      event: 'management-password-changed',
      actorRef: 'dashboard:actor-ref',
      details: { revision: 7, password: '[redacted]', token: '[redacted]' }
    });
    expect(JSON.stringify(event)).not.toContain(secretSentinel);
    expect(JSON.stringify(event)).not.toContain(tokenSentinel);
    expect(await listManagementSecurityEvents({ accountKey: 'Room One' })).toEqual([event]);
  });

  it('uses the isolated Firestore implementation in tests without an alternate datastore', () => {
    expect(getDatabaseStatus()).toEqual({
      engine: 'firestore',
      durable: false,
      authoritative: true,
      mode: 'memory-test'
    });
  });

  it('upserts and queries complete client records while retaining non-empty update fields', async () => {
    const inserted = await upsertClient(clientPayload);
    expect(inserted).toMatchObject({
      deviceId: 'device-1',
      venueId: 'character-club',
      venueName: 'Character Club',
      deviceName: 'Front Desk',
      appVersion: '1.2.3',
      platform: 'win32',
      environment: 'test',
      updateStatus: 'ready',
      updateEvent: 'update-ready',
      lastError: '',
      currentUser: null
    });

    const updated = await upsertClient({
      ...clientPayload,
      venueId: 'Second Room',
      venueName: 'Second Room',
      appVersion: '1.2.4',
      updateStatus: '',
      updateEvent: '',
      currentUser: null,
      lastSeenAt: '2026-08-07T13:00:00.000Z'
    });

    expect(updated).toMatchObject({
      venueId: 'second-room',
      venueName: 'Second Room',
      appVersion: '1.2.4',
      updateStatus: 'ready',
      updateEvent: 'update-ready',
      currentUser: null,
      lastSeenAt: '2026-08-07T13:00:00.000Z'
    });
    expect(updated.firstSeenAt).toBe(inserted.firstSeenAt);
    expect(await getClient('device-1')).toEqual(updated);
    expect(await listClients({ venueId: 'Second Room' })).toEqual([updated]);
  });

  it('records update, usage, and error history with current filtering and summary behavior', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00.000Z'));
    const updateClient = await recordUpdateEvent({
      ...clientPayload,
      updateEvent: 'downloaded',
      updateStatus: 'complete',
      occurredAt: '2026-08-07T14:00:00.000Z',
      details: { version: '1.2.4' }
    });
    const usageEvent = await recordTelemetryEvent({
      ...clientPayload,
      event: 'table-started',
      category: 'operations',
      route: 'floor',
      occurredAt: '2026-08-07T15:00:00.000Z',
      details: { tableId: 'table-1' }
    });
    const error = await recordClientError({
      ...clientPayload,
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: 'example stack',
      occurredAt: '2026-08-07T16:00:00.000Z',
      details: { recoverable: true }
    });

    expect(updateClient.updateStatus).toBe('complete');
    expect(await listClientUpdateEvents('device-1')).toEqual([
      expect.objectContaining({
        deviceId: 'device-1',
        venueId: 'character-club',
        event: 'downloaded',
        status: 'complete',
        details: { version: '1.2.4' },
        occurredAt: '2026-08-07T14:00:00.000Z'
      })
    ]);
    expect(usageEvent).toMatchObject({
      deviceId: 'device-1',
      event: 'table-started',
      category: 'operations',
      route: 'floor',
      details: { tableId: 'table-1' }
    });
    expect((await listTelemetryEvents({ deviceId: 'device-1', limit: 10 })).map((event) => event.event)).toEqual([
      'table-started',
      'downloaded'
    ]);
    expect(error).toMatchObject({
      deviceId: 'device-1',
      message: 'Renderer failed',
      source: 'renderer',
      route: 'floor',
      stack: expect.stringMatching(/^fingerprint:[a-f0-9]{16}$/),
      details: { recoverable: true }
    });
    expect(await listClientErrors({ venueId: 'Character Club' })).toEqual([error]);
    expect((await getClient('device-1'))?.lastError).toBe('Renderer failed');
    expect(await getTelemetrySummary()).toMatchObject({ clients: 1, events: 2, errors: 1, tableStarts24h: 1 });
  });

  it('stores and lists production telemetry without raw credentials or identity/payment payloads', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ORBIT_FIRESTORE_MEMORY', 'true');
    vi.stubEnv('ORBIT_LOG_HASH_SECRET', 'telemetry-log-hash-secret-with-at-least-32-characters');
    const fixtures = [
      'production-bearer-token-value',
      ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJwcml2YXRlIn0', 'signature12345'].join('.'),
      ['sk', 'live', 'telemetrySecret123456'].join('_'),
      'private-telemetry-key-body',
      'RAW-TELEMETRY-PDF417',
      'DOCUMENT-PRIVATE-123',
      'PAYMENT-PRIVATE-123',
      '4111 1111 1111 1111',
      '@\nANSI 636026080102DL00410288ZA03290015DLDAQD1234567',
      ['z8Qp4mN7vR2xL9cT5kH3sF6', 'jB1wD0yU8aE4gI7oP2qS9nM5'].join('')
    ];
    const sensitiveText = [
      `Bearer ${fixtures[0]}`,
      fixtures[1],
      fixtures[2],
      `barcode=${fixtures[4]}`,
      `documentNumber=${fixtures[5]}`,
      `paymentToken=${fixtures[6]}`,
      fixtures[7]
    ].join('; ');

    const recorded = await recordClientError({
      ...clientPayload,
      deviceId: 'sensitive-telemetry-device',
      venueId: 'Sensitive Telemetry Room',
      venueName: `Sensitive Telemetry Room barcode=${fixtures[4]}`,
      deviceName: `Bearer ${fixtures[0]}`,
      appVersion: fixtures[2],
      platform: fixtures[1],
      environment: `documentNumber=${fixtures[5]}`,
      updateStatus: `paymentToken=${fixtures[6]}`,
      updateEvent: `barcode=${fixtures[4]}`,
      message: sensitiveText,
      source: `paymentToken=${fixtures[6]}`,
      route: `cardNumber=${fixtures[7]}`,
      stack: `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\n${fixtures[3]}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`,
      details: {
        note: sensitiveText,
        rawBarcode: fixtures[4],
        document: fixtures[5],
        paymentCard: fixtures[7]
      }
    });
    const clientAfterError = await getClient('sensitive-telemetry-device');
    const usage = await recordTelemetryEvent({
      ...clientPayload,
      deviceId: 'sensitive-telemetry-device',
      venueId: 'Sensitive Telemetry Room',
      event: `Bearer ${fixtures[0]}`,
      category: fixtures[9],
      route: fixtures[2],
      appVersion: `barcode=${fixtures[4]}`,
      platform: `documentNumber=${fixtures[5]}`,
      details: { note: fixtures[8], opaqueValue: fixtures[9], labeled: sensitiveText }
    });
    await recordUpdateEvent({
      ...clientPayload,
      deviceId: 'sensitive-telemetry-device',
      venueId: 'Sensitive Telemetry Room',
      updateEvent: `paymentToken=${fixtures[6]}`,
      updateStatus: `cardNumber=${fixtures[7]}`,
      appVersion: fixtures[2],
      details: { note: fixtures[8], opaqueValue: fixtures[9], labeled: sensitiveText }
    });
    const opaqueClient = await upsertClient({
      ...clientPayload,
      deviceId: 'opaque-client-label-device',
      venueId: fixtures[9],
      venueName: fixtures[9],
      deviceName: fixtures[9]
    });
    const rawDatabase = await connection.getDatabase();
    const legacyBase = {
      id: 'legacy-unsafe-record',
      deviceId: 'legacy-unsafe-client',
      venueId: 'legacy-unsafe-room',
      event: fixtures[9],
      appVersion: fixtures[2],
      details: { raw: fixtures[8], opaque: fixtures[9] },
      unexpectedRaw: fixtures[9],
      occurredAt: '2026-08-07T17:00:00.000Z',
      createdAt: '2026-08-07T17:00:00.000Z'
    };
    await rawDatabase.createDocument('orbitClients/legacy-unsafe-client', {
      ...clientPayload,
      deviceId: 'legacy-unsafe-client',
      venueId: 'legacy-unsafe-room',
      venueName: fixtures[9],
      deviceName: fixtures[9],
      appVersion: fixtures[2],
      platform: fixtures[1],
      environment: `barcode=${fixtures[4]}`,
      updateStatus: `documentNumber=${fixtures[5]}`,
      updateEvent: `paymentToken=${fixtures[6]}`,
      lastError: sensitiveText,
      currentUser: { barcode: fixtures[4], name: fixtures[9] }
    });
    await rawDatabase.createDocument('orbitTelemetryEvents/legacy-unsafe-event', {
      ...legacyBase,
      category: fixtures[9],
      route: fixtures[2],
      platform: fixtures[1]
    });
    await rawDatabase.createDocument('orbitClientUpdateEvents/legacy-unsafe-update', {
      ...legacyBase,
      status: `documentNumber=${fixtures[5]}`,
      error: sensitiveText
    });
    await rawDatabase.createDocument('orbitClientErrors/legacy-unsafe-error', {
      ...legacyBase,
      message: sensitiveText,
      errorRef: fixtures[9],
      source: `paymentToken=${fixtures[6]}`,
      route: `barcode=${fixtures[4]}`,
      stack: `${['-----BEGIN', 'PRIVATE KEY-----'].join(' ')}\n${fixtures[3]}\n${['-----END', 'PRIVATE KEY-----'].join(' ')}`,
      platform: fixtures[1]
    });
    expect(await rawDatabase.getDocument('orbitClients/legacy-unsafe-client')).not.toBeNull();
    const databaseDependencies = { database: rawDatabase };
    const legacyClient = await getClient('legacy-unsafe-client', databaseDependencies);
    const legacyEvents = await listTelemetryEvents({ deviceId: 'legacy-unsafe-client' }, databaseDependencies);
    const legacyUpdates = await listClientUpdateEvents('legacy-unsafe-client', {}, databaseDependencies);
    const legacyErrors = await listClientErrors({ deviceId: 'legacy-unsafe-client' }, databaseDependencies);
    const listed = await listClientErrors({ venueId: 'Sensitive Telemetry Room' });
    const listedEvents = await listTelemetryEvents({ venueId: 'Sensitive Telemetry Room' });
    const listedUpdates = await listClientUpdateEvents('sensitive-telemetry-device');
    const client = await getClient('sensitive-telemetry-device');
    const serialized = JSON.stringify({
      recorded,
      usage,
      listed,
      listedEvents,
      listedUpdates,
      clientAfterError,
      client,
      opaqueClient,
      legacyClient,
      legacyEvents,
      legacyUpdates,
      legacyErrors
    });

    expect(recorded).toMatchObject({
      message: expect.stringMatching(/^Client error recorded\. reference:[a-f0-9]{16}$/),
      errorRef: expect.stringMatching(/^[a-f0-9]{16}$/),
      stack: expect.stringMatching(/^fingerprint:[a-f0-9]{16}$/),
      details: null
    });
    expect(listed).toEqual([recorded]);
    expect(clientAfterError?.lastError).toMatch(/^Client error recorded\. reference:[a-f0-9]{16}$/);
    expect(opaqueClient).toMatchObject({
      venueId: expect.stringMatching(/^protected-[a-f0-9]{16}$/),
      venueName: expect.stringMatching(/^Protected client label [a-f0-9]{16}$/),
      deviceName: expect.stringMatching(/^Protected client label [a-f0-9]{16}$/)
    });
    expect(legacyClient).toMatchObject({
      venueName: expect.stringMatching(/^Protected client label [a-f0-9]{16}$/),
      deviceName: expect.stringMatching(/^Protected client label [a-f0-9]{16}$/),
      lastError: expect.stringMatching(/^Client error recorded\. reference:[a-f0-9]{16}$/),
      currentUser: null
    });
    expect(legacyEvents).toEqual([expect.objectContaining({ details: null })]);
    expect(legacyUpdates).toEqual([expect.objectContaining({
      details: null,
      error: expect.stringMatching(/^Client update error recorded\. reference:[a-f0-9]{16}$/)
    })]);
    expect(legacyErrors).toEqual([expect.objectContaining({
      message: expect.stringMatching(/^Client error recorded\. reference:[a-f0-9]{16}$/),
      errorRef: expect.stringMatching(/^[a-f0-9]{16}$/),
      stack: expect.stringMatching(/^fingerprint:[a-f0-9]{16}$/),
      details: null
    })]);
    for (const fixture of fixtures) expect(serialized).not.toContain(fixture);
  });

  it('round-trips normalized revisioned state, venue joins, reports, and close/reopen persistence', async () => {
    const state = makeState();
    const saved = await saveState(state, { expectedRevision: 0, mutationId: 'initial-state' });

    expect(saved.accountKey).toBe('owner-example.com');
    expect(await loadState('Owner@Example.com')).toMatchObject({
      accountKey: 'owner-example.com',
      venueName: 'Character Club',
      schemaVersion: 2,
      revision: 1,
      state
    });
    expect(await loadLatestState()).toMatchObject({ accountKey: 'owner-example.com', revision: 1, state });
    expect(await listStatePage({ limit: 25 })).toMatchObject({
      records: [expect.objectContaining({ accountKey: 'owner-example.com', revision: 1, state })],
      hasMore: false,
      nextCursor: null,
      queryCount: 2
    });
    expect(await listVenues()).toEqual([
      expect.objectContaining({
        venueId: 'owner-example.com',
        venueName: 'Character Club',
        clientCount: 0
      })
    ]);
    await expect(saveState({ ...state, games: null }, { expectedRevision: 1, mutationId: 'invalid' })).rejects.toThrow('State payload is missing games.');
    expect((await loadState('owner-example.com'))?.state).toEqual(state);

    const report = await storeAnalyticalReport({
      account: { accountKey: 'Owner@Example.com' },
      summary: { tables: 3 }
    });
    expect(report).toMatchObject({
      ok: true,
      accountKey: 'owner-example.com',
      deliveryStatus: 'stored'
    });
    expect(report.id).toMatch(/^[0-9a-f-]{36}$/i);

    await closeDatabase();
    expect((await loadState('owner-example.com'))?.state).toEqual(state);
  });
});
