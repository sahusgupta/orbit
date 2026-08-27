import { describe, expect, it, vi } from 'vitest';
import selfCheckInRoutes from './selfCheckIn.js';

const {
  createSelfCheckInHandlers,
  requireSelfCheckInIssuer
} = selfCheckInRoutes;

const signingSecret = 'test-route-self-check-in-secret-at-least-32';
const now = '2026-08-24T12:00:00.000Z';

function baseState(overrides = {}) {
  return {
    settings: {
      clubAccount: { clubName: 'Orbit Room' },
      pilotAccess: {
        authorized: true,
        authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA',
        licenseId: 'club-one',
        expiresAt: '2027-08-24T12:00:00.000Z'
      }
    },
    games: [{ id: 'game-one', name: '1/2 NLH' }],
    profiles: [{ id: 'profile-one', name: 'José O’Brien', preferredGameIds: [], gamePlayCounts: {} }],
    interests: [],
    sessions: [{ id: 'table-one', gameId: 'game-one', label: 'Table 1', status: 'Running', maxSeats: 2, seatsFilled: 0 }],
    playerSessions: [],
    playerLedger: [],
    staffRequests: [],
    ...overrides
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: new Map(),
    payload: undefined,
    set(name, value) {
      if (typeof name === 'object') {
        Object.entries(name).forEach(([key, item]) => this.headers.set(key.toLowerCase(), String(item)));
      } else {
        this.headers.set(String(name).toLowerCase(), String(value));
      }
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.payload = value;
      return this;
    }
  };
}

function createRequest(input = {}) {
  const headers = Object.fromEntries(Object.entries(input.headers || {}).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    body: input.body,
    orbitAuth: input.orbitAuth,
    protocol: 'https',
    get(name) {
      if (name.toLowerCase() === 'host') return 'check-in.example.test';
      return headers[name.toLowerCase()];
    },
    is(contentType) {
      return contentType === 'application/json' && String(headers['content-type'] || '').toLowerCase().startsWith('application/json');
    }
  };
}

function capabilityFrom(response) {
  return new URLSearchParams(new URL(response.payload.checkInUrl).hash.slice(1)).get('token');
}

function createHarness(initialState = baseState(), dependencyOverrides = {}) {
  let counter = 0;
  let record = { revision: 1, state: structuredClone(initialState) };
  let conflictOnNextSave = false;
  let conflictStateTransform;
  let duplicateStateOnNextSave;
  const loadState = vi.fn(async (accountKey) => accountKey === 'club-one' ? structuredClone(record) : null);
  const saveState = vi.fn(async (state, options) => {
    if (options.expectedRevision !== record.revision) {
      throw Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' });
    }
    if (conflictOnNextSave) {
      conflictOnNextSave = false;
      record = {
        revision: record.revision + 1,
        state: conflictStateTransform ? conflictStateTransform(record.state) : {
          ...record.state,
          playerSessions: [
            { id: 'occupant-one', profileId: 'other-one', tableId: 'table-one', gameId: 'game-one', seatNumber: 1, seatedAt: now },
            { id: 'occupant-two', profileId: 'other-two', tableId: 'table-one', gameId: 'game-one', seatNumber: 2, seatedAt: now }
          ]
        }
      };
      conflictStateTransform = undefined;
      throw Object.assign(new Error('conflict'), { code: 'STATE_REVISION_CONFLICT' });
    }
    if (duplicateStateOnNextSave) {
      record = {
        revision: record.revision + 1,
        state: structuredClone(duplicateStateOnNextSave(record.state))
      };
      duplicateStateOnNextSave = undefined;
      return { accountKey: 'club-one', revision: record.revision, duplicate: true };
    }
    record = { revision: record.revision + 1, state: structuredClone(state) };
    return { accountKey: 'club-one', revision: record.revision, duplicate: false };
  });
  const schedulePublicationDrain = vi.fn();
  const handlers = createSelfCheckInHandlers({
    secret: signingSecret,
    publicOrigin: 'https://check-in.example.test',
    nowIso: () => now,
    nowMs: () => Date.parse(now),
    randomUUID: () => `generated-${++counter}`,
    inspectPilotLicense: vi.fn(async () => ({
      managed: true,
      active: true,
      license: {
        accountKey: 'club-one',
        expiresAt: '2027-08-24T12:00:00.000Z',
        status: 'active',
        updatedAt: '2026-08-23T12:00:00.000Z'
      }
    })),
    loadState,
    saveState,
    schedulePublicationDrain,
    ...dependencyOverrides
  });
  return {
    handlers,
    loadState,
    saveState,
    schedulePublicationDrain,
    get state() { return record.state; },
    mutateState(transform) {
      record = {
        revision: record.revision + 1,
        state: structuredClone(transform(record.state))
      };
    },
    conflictOnNextSave(transform) {
      conflictOnNextSave = true;
      conflictStateTransform = transform;
    },
    duplicateNextSave(transform) { duplicateStateOnNextSave = transform; }
  };
}

let issueSequence = 0;

async function issue(harness, mutationId = `issue-${++issueSequence}`) {
  const response = createResponse();
  await harness.handlers.issueClubKit(createRequest({
    headers: { 'content-type': 'application/json' },
    body: { mutationId },
    orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] }
  }), response);
  expect([200, 201]).toContain(response.statusCode);
  expect(response.payload.accountKey).toBe('club-one');
  return { response, capability: capabilityFrom(response) };
}

async function lookup(harness, capability, body) {
  const response = createResponse();
  await harness.handlers.lookupPlayer(createRequest({
    headers: { 'content-type': 'application/json', 'x-orbit-check-in-token': capability },
    body
  }), response);
  return response;
}

async function context(harness, capability, body = {}) {
  const response = createResponse();
  await harness.handlers.getClubContext(createRequest({
    headers: { 'content-type': 'application/json', 'x-orbit-check-in-token': capability },
    body
  }), response);
  return response;
}

describe('self-check-in API routes', () => {
  it('restricts QR issuance to a tenant-bound client:write identity', () => {
    const next = vi.fn();
    const missingTenant = createResponse();
    requireSelfCheckInIssuer({ orbitAuth: { scopes: ['client:write'] } }, missingTenant, next);
    expect(missingTenant.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();

    const wrongScope = createResponse();
    requireSelfCheckInIssuer({ orbitAuth: { accountKey: 'club-one', scopes: ['client:read'] } }, wrongScope, next);
    expect(wrongScope.statusCode).toBe(403);

    requireSelfCheckInIssuer({ orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] } }, createResponse(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns only the verified club context before player lookup', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);

    const response = await context(harness, capability);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({ ok: true, status: 'ready', clubName: 'Orbit Room' });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.payload).not.toHaveProperty('profiles');
    expect(response.payload).not.toHaveProperty('tables');
    expect(response.payload).not.toHaveProperty('playerSessions');
    expect(harness.saveState).toHaveBeenCalledOnce();
  });

  it('rejects unsupported context input and a rotated capability', async () => {
    const harness = createHarness();
    const first = await issue(harness);
    const unsupported = await context(harness, first.capability, { name: 'Player' });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.payload).toMatchObject({ code: 'INVALID_INPUT' });

    await issue(harness);
    const revoked = await context(harness, first.capability);
    expect(revoked.statusCode).toBe(410);
    expect(revoked.payload).toMatchObject({ code: 'CHECK_IN_TOKEN_REVOKED' });
  });

  it('rejects club context when the active license is removed', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    harness.mutateState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        pilotAccess: { ...state.settings.pilotAccess, authorized: false }
      }
    }));

    const response = await context(harness, capability);

    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
  });

  it('rejects non-JSON, unsupported fields, invalid names, and invalid identifiers before state access', async () => {
    const harness = createHarness();
    const nonJson = createResponse();
    await harness.handlers.lookupPlayer(createRequest({ body: {} }), nonJson);
    expect(nonJson.statusCode).toBe(415);

    const extra = createResponse();
    await harness.handlers.lookupPlayer(createRequest({
      headers: { 'content-type': 'application/json' },
      body: { name: 'Valid Player', mutationId: 'valid-id', admin: true }
    }), extra);
    expect(extra.statusCode).toBe(400);

    const invalid = createResponse();
    await harness.handlers.lookupPlayer(createRequest({
      headers: { 'content-type': 'application/json' },
      body: { name: '<script>', mutationId: 'has spaces' }
    }), invalid);
    expect(invalid.statusCode).toBe(400);
    expect(harness.loadState).not.toHaveBeenCalled();

    const invalidIssuer = createResponse();
    await harness.handlers.issueClubKit(createRequest({
      headers: { 'content-type': 'application/json' },
      body: {},
      orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] }
    }), invalidIssuer);
    expect(invalidIssuer.statusCode).toBe(400);
  });

  it.each([
    ['unauthorized state', { authorized: false, authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA', licenseId: 'club-one', expiresAt: '2027-08-24T12:00:00.000Z' }],
    ['missing expiration', { authorized: true, authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA', licenseId: 'club-one' }],
    ['malformed expiration', { authorized: true, authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA', licenseId: 'club-one', expiresAt: 'not-a-date' }],
    ['expired state', { authorized: true, authorizationCode: 'TT-PILOT-AAAAAAAAAAAAAAAAAAAAAAAA', licenseId: 'club-one', expiresAt: '2026-08-23T12:00:00.000Z' }]
  ])('fails closed when QR issuance has %s', async (_label, pilotAccess) => {
    const initial = baseState({
      settings: { ...baseState().settings, pilotAccess }
    });
    const harness = createHarness(initial);
    const response = createResponse();
    await harness.handlers.issueClubKit(createRequest({
      headers: { 'content-type': 'application/json' },
      body: { mutationId: 'inactive-license-issue' },
      orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] }
    }), response);
    expect(response.statusCode).toBe(403);
    expect(response.payload).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
    expect(harness.saveState).not.toHaveBeenCalled();
  });

  it('reissues the same generation after an ambiguous issuer retry without another rotation', async () => {
    const harness = createHarness();
    const first = await issue(harness, 'stable-issuer-request');
    const replay = await issue(harness, 'stable-issuer-request');

    expect(first.response.statusCode).toBe(201);
    expect(replay.response.statusCode).toBe(200);
    expect(replay.response.payload.selfCheckIn).toEqual(first.response.payload.selfCheckIn);
    expect(replay.response.payload.rotatedPreviousCode).toBe(false);
    expect(harness.saveState).toHaveBeenCalledOnce();
  });

  it('refuses QR issuance when the central club license is inactive', async () => {
    const inspectPilotLicense = vi.fn(async () => ({
      managed: true,
      active: false,
      license: { accountKey: 'club-one', status: 'revoked', expiresAt: '2027-08-24T12:00:00.000Z' }
    }));
    const harness = createHarness(baseState(), { inspectPilotLicense });
    const response = createResponse();

    await harness.handlers.issueClubKit(createRequest({
      headers: { 'content-type': 'application/json' },
      body: { mutationId: 'central-revoked-issue' },
      orbitAuth: { accountKey: 'club-one', scopes: ['client:write'] }
    }), response);

    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
    expect(harness.saveState).not.toHaveBeenCalled();
  });

  it('recognizes a known player, returns live availability, and seats exactly once', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    const recognized = await lookup(harness, capability, { name: '  José   O’Brien ', mutationId: 'lookup-one' });
    expect(recognized.statusCode).toBe(200);
    expect(recognized.payload).toMatchObject({
      ok: true,
      status: 'recognized',
      clubName: 'Orbit Room',
      playerName: 'José O’Brien',
      tables: [{ id: 'table-one', availableSeats: 2 }]
    });

    const seated = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': recognized.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'seat-one' }
    }), seated);
    expect(seated.statusCode).toBe(201);
    expect(seated.payload).toMatchObject({ status: 'seated', tableLabel: 'Table 1', seatNumber: 1 });
    expect(harness.state.playerSessions).toHaveLength(1);
    expect(harness.state.interests).toHaveLength(1);
    expect(harness.state.playerLedger).toHaveLength(1);

    const replay = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': recognized.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'different-client-id' }
    }), replay);
    expect(replay.statusCode).toBe(200);
    expect(replay.payload).toMatchObject({ status: 'already-seated', tableLabel: 'Table 1', seatNumber: 1 });
    expect(harness.state.playerSessions).toHaveLength(1);
  });

  it('offers the freed table again after Core checks the player out and allows a fresh seating session', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    const firstLookup = await lookup(harness, capability, {
      name: baseState().profiles[0].name,
      mutationId: 'first-lifecycle-lookup'
    });
    const firstSeat = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': firstLookup.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'first-lifecycle-seat' }
    }), firstSeat);
    expect(firstSeat.payload).toMatchObject({ status: 'seated', seatNumber: 1 });

    harness.mutateState((state) => ({
      ...state,
      interests: state.interests.map((interest) => ({
        ...interest,
        status: 'Removed',
        closedAt: '2026-08-24T13:00:00.000Z'
      })),
      playerSessions: state.playerSessions.map((session) => ({
        ...session,
        leftAt: '2026-08-24T13:00:00.000Z'
      })),
      sessions: state.sessions.map((table) => ({ ...table, seatsFilled: 0 }))
    }));

    const secondLookup = await lookup(harness, capability, {
      name: baseState().profiles[0].name,
      mutationId: 'second-lifecycle-lookup'
    });
    expect(secondLookup.payload).toMatchObject({
      status: 'recognized',
      tables: [{ id: 'table-one', availableSeats: 2 }]
    });

    const secondSeat = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': secondLookup.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'second-lifecycle-seat' }
    }), secondSeat);

    expect(secondSeat.payload).toMatchObject({ status: 'seated', seatNumber: 1 });
    expect(harness.state.playerSessions).toHaveLength(2);
    expect(harness.state.playerSessions.filter((session) => !session.leftAt)).toEqual([
      expect.objectContaining({ seatNumber: 1 })
    ]);
    expect(harness.state.interests.filter((interest) => interest.status === 'Seated')).toHaveLength(1);
  });

  it('creates one durable assistance alert for an unknown player and rejects changed replay input', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    const first = await lookup(harness, capability, { name: 'New Player', mutationId: 'unknown-one' });
    expect(first.statusCode).toBe(202);
    expect(first.payload).toMatchObject({ status: 'needs-assistance', clubName: 'Orbit Room' });
    expect(harness.state.staffRequests).toEqual([
      expect.objectContaining({ playerName: 'New Player', reason: 'not-found', status: 'pending' })
    ]);
    expect(harness.state.profiles).toHaveLength(1);
    expect(harness.state.interests).toHaveLength(0);

    const replay = await lookup(harness, capability, { name: 'New Player', mutationId: 'unknown-one' });
    expect(replay.statusCode).toBe(202);
    expect(harness.state.staffRequests).toHaveLength(1);

    const changedReplay = await lookup(harness, capability, { name: 'Different Player', mutationId: 'unknown-one' });
    expect(changedReplay.statusCode).toBe(409);
    expect(changedReplay.payload).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(harness.state.staffRequests).toHaveLength(1);
  });

  it('fails closed and raises an operational alert when every assistance slot is pending', async () => {
    const pending = Array.from({ length: 200 }, (_value, index) => ({
      id: `pending-${index}`,
      type: 'self-check-in-assistance',
      playerName: `Pending Player ${index}`,
      reason: 'not-found',
      status: 'pending',
      createdAt: now
    }));
    const sendOperationalAlert = vi.fn().mockResolvedValue(undefined);
    const harness = createHarness(baseState({ staffRequests: pending }), { sendOperationalAlert });
    const { capability } = await issue(harness);

    const response = await lookup(harness, capability, { name: 'Overflow Player', mutationId: 'queue-overflow' });

    expect(response.statusCode).toBe(503);
    expect(response.payload).toMatchObject({ ok: false, code: 'CHECK_IN_UNAVAILABLE' });
    expect(harness.state.staffRequests).toEqual(pending);
    expect(sendOperationalAlert).toHaveBeenCalledWith(
      'self-check-in-assistance-queue-full',
      'warning',
      expect.objectContaining({ tenantRef: expect.any(String) })
    );
  });

  it('invalidates an issued code when the central club license is revoked', async () => {
    let active = true;
    const inspectPilotLicense = vi.fn(async () => ({
      managed: true,
      active,
      license: {
        accountKey: 'club-one',
        status: active ? 'active' : 'revoked',
        expiresAt: '2027-08-24T12:00:00.000Z',
        updatedAt: '2026-08-23T12:00:00.000Z'
      }
    }));
    const harness = createHarness(baseState(), { inspectPilotLicense });
    const { capability } = await issue(harness);
    active = false;

    const response = await lookup(harness, capability, { name: 'José O’Brien', mutationId: 'revoked-license' });
    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
  });

  it('does not create an assistance alert if the local license becomes inactive during a retry', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    harness.conflictOnNextSave((state) => ({
      ...state,
      settings: {
        ...state.settings,
        pilotAccess: { ...state.settings.pilotAccess, authorized: false }
      }
    }));

    const response = await lookup(harness, capability, { name: 'New Player', mutationId: 'expired-during-retry' });

    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'PILOT_LICENSE_INACTIVE' });
    expect(harness.state.staffRequests).toEqual([]);
    expect(harness.saveState).toHaveBeenCalledTimes(2);
  });

  it('keeps an old code revoked after the central license is later reactivated', async () => {
    const inspectPilotLicense = vi.fn(async () => ({
      managed: true,
      active: true,
      license: {
        accountKey: 'club-one',
        status: 'active',
        expiresAt: '2027-08-24T12:00:00.000Z',
        updatedAt: '2026-08-24T12:01:00.000Z'
      }
    }));
    const harness = createHarness(baseState(), { inspectPilotLicense });
    const { capability } = await issue(harness);

    const response = await lookup(harness, capability, { name: 'José O’Brien', mutationId: 'reactivated-license' });
    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'CHECK_IN_TOKEN_REVOKED' });
  });

  it('does not disclose a seated player table or seat from a name-only lookup', async () => {
    const harness = createHarness(baseState({
      playerSessions: [{
        id: 'existing-seat',
        profileId: 'profile-one',
        playerName: 'José O’Brien',
        gameId: 'game-one',
        tableId: 'table-one',
        seatNumber: 2,
        seatedAt: now
      }]
    }));
    const { capability } = await issue(harness);
    const response = await lookup(harness, capability, { name: 'José O’Brien', mutationId: 'already-seated-privacy' });

    expect(response.statusCode).toBe(200);
    expect(response.payload).toEqual({
      ok: true,
      status: 'already-seated',
      clubName: 'Orbit Room',
      message: 'You are already checked in. Ask club staff if you need help with your seat.'
    });
  });

  it('reloads authoritative state when an idempotency receipt wins a concurrent seating race', async () => {
    const initial = baseState({
      sessions: [
        { id: 'table-one', gameId: 'game-one', label: 'Table 1', status: 'Running', maxSeats: 2, seatsFilled: 0 },
        { id: 'table-two', gameId: 'game-one', label: 'Table 2', status: 'Running', maxSeats: 2, seatsFilled: 1 }
      ]
    });
    const harness = createHarness(initial);
    const { capability } = await issue(harness);
    const recognized = await lookup(harness, capability, { name: 'José O’Brien', mutationId: 'concurrent-lookup' });
    harness.duplicateNextSave((state) => ({
      ...state,
      playerSessions: [{
        id: 'concurrent-winner',
        profileId: 'profile-one',
        playerName: 'José O’Brien',
        gameId: 'game-one',
        tableId: 'table-two',
        seatNumber: 1,
        seatedAt: now
      }]
    }));

    const response = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': recognized.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'concurrent-seat' }
    }), response);

    expect(response.statusCode).toBe(200);
    expect(response.payload).toMatchObject({ status: 'already-seated', tableLabel: 'Table 2', seatNumber: 1 });
    expect(harness.state.playerSessions).toEqual([expect.objectContaining({ tableId: 'table-two' })]);
  });

  it('rechecks capacity after a CAS conflict and returns refreshed table availability', async () => {
    const harness = createHarness();
    const { capability } = await issue(harness);
    const recognized = await lookup(harness, capability, { name: 'José O’Brien', mutationId: 'lookup-race' });
    harness.conflictOnNextSave();

    const response = createResponse();
    await harness.handlers.seatPlayer(createRequest({
      headers: { 'content-type': 'application/json', 'x-orbit-check-in-session': recognized.payload.sessionToken },
      body: { tableId: 'table-one', mutationId: 'seat-race' }
    }), response);
    expect(response.statusCode).toBe(409);
    expect(response.payload).toEqual({
      ok: false,
      code: 'TABLE_UNAVAILABLE',
      error: 'That table is no longer available. Choose another table.',
      tables: []
    });
    expect(harness.state.playerSessions).toHaveLength(2);
  });

  it('revokes the prior printed capability when a new club kit is generated', async () => {
    const harness = createHarness();
    const first = await issue(harness);
    await issue(harness);
    const response = await lookup(harness, first.capability, { name: 'José O’Brien', mutationId: 'old-code' });
    expect(response.statusCode).toBe(410);
    expect(response.payload).toMatchObject({ code: 'CHECK_IN_TOKEN_REVOKED' });
  });
});
