/**
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const publicDirectory = path.resolve(process.cwd(), 'apps/api/public');
const pageHtml = readFileSync(path.join(publicDirectory, 'self-check-in.html'), 'utf8');
const pageScript = readFileSync(path.join(publicDirectory, 'self-check-in.js'), 'utf8');
const capability = 'v1.club-capability-token-that-is-long-enough.signature';
const sessionToken = 'v1.player-session-token-that-is-long-enough.signature';
const refreshedSessionToken = 'v1.refreshed-player-session-that-is-long-enough.signature';
const futureSessionExpiration = '2099-08-24T12:05:00.000Z';
const browser = /** @type {any} */ (globalThis);
const document = browser.document;
const window = browser.window;
const sessionStorage = browser.sessionStorage;
const BrowserEvent = browser.Event;
const BrowserMouseEvent = browser.MouseEvent;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function availableTable(overrides = {}) {
  return {
    id: 'table-one',
    label: 'Table 1',
    gameId: 'game-one',
    gameName: '1/2 NLH',
    status: 'Running',
    availableSeats: 2,
    maxSeats: 9,
    ...overrides
  };
}

function recognizedPayload(overrides = {}) {
  return {
    ok: true,
    status: 'recognized',
    clubName: 'Orbit Room',
    playerName: 'José O’Brien',
    sessionToken,
    sessionExpiresAt: futureSessionExpiration,
    tables: [availableTable()],
    ...overrides
  };
}

function installPage(
  responses,
  fragment = `#token=${capability}`,
  contextResponse = jsonResponse({ ok: true, status: 'ready', clubName: 'Orbit Room' })
) {
  document.documentElement.innerHTML = pageHtml;
  window.history.replaceState(null, '', `/check-in${fragment}`);
  sessionStorage.clear();
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    callback(0);
    return 1;
  });
  const fetch = vi.fn();
  for (const response of [contextResponse, ...responses]) fetch.mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetch);
  Function(pageScript)();
  return fetch;
}

function actionCalls(fetch) {
  return fetch.mock.calls.filter((call) => call[0] !== '/player/check-in/context');
}

async function waitForNameStep() {
  await vi.waitFor(() => expect(document.querySelector('#name-step')?.hasAttribute('hidden')).toBe(false));
  await vi.waitFor(() => expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false'));
}

async function submitName(name = 'José O’Brien') {
  await waitForNameStep();
  const input = /** @type {any} */ (document.querySelector('#player-name'));
  input.value = name;
  document.querySelector('#lookup-form').dispatchEvent(new BrowserEvent('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false'));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.documentElement.innerHTML = '<head></head><body></body>';
  window.history.replaceState(null, '', '/');
});

describe('public self-check-in page', () => {
  it('shows a verified, minimal club-specific landing step', async () => {
    const fetch = installPage([]);

    await waitForNameStep();

    expect(document.querySelector('#name-heading')?.textContent?.replace(/\s+/gu, ' ').trim()).toBe('Check in to Orbit Room');
    expect(document.querySelector('#player-name')?.getAttribute('placeholder')).toBe('Name');
    expect(document.querySelector('#lookup-button')?.getAttribute('aria-label')).toBe('Continue');
    expect(document.querySelector('.brand-header')?.textContent?.trim()).toBe('');
    expect(document.querySelector('#name-step .lead')).toBeNull();
    expect(document.querySelector('#name-step .field-hint')).toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
    const request = fetch.mock.calls[0][1];
    expect(fetch.mock.calls[0][0]).toBe('/player/check-in/context');
    expect(request.method).toBe('POST');
    expect(request.cache).toBe('no-store');
    expect(request.credentials).toBe('same-origin');
    expect(request.referrerPolicy).toBe('no-referrer');
    expect(request.headers['x-orbit-check-in-token']).toBe(capability);
    expect(request.body).toBe('{}');
    expect(request.body).not.toContain(capability);
  });

  it('fails closed before showing the name form when club context is invalid', async () => {
    const fetch = installPage([], `#token=${capability}`, jsonResponse({
      ok: false,
      code: 'CHECK_IN_TOKEN_REVOKED',
      error: 'This club check-in code is no longer active.'
    }, 410));

    await vi.waitFor(() => expect(document.querySelector('#assistance-step')?.hasAttribute('hidden')).toBe(false));

    expect(fetch).toHaveBeenCalledOnce();
    expect(document.querySelector('#name-step')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#assistance-message')?.textContent).toContain('staff member');
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('strips the bearer fragment, sends credentials only in headers, and completes seating', async () => {
    const fetch = installPage([
      jsonResponse(recognizedPayload()),
      jsonResponse({
        ok: true,
        status: 'seated',
        clubName: 'Orbit Room',
        playerName: 'José O’Brien',
        tableLabel: 'Table 1',
        gameName: '1/2 NLH',
        seatNumber: 3
      }, 201)
    ]);

    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBe(capability);
    await waitForNameStep();
    expect(document.activeElement).toBe(document.querySelector('#player-name'));
    await submitName();
    expect(document.querySelector('#table-step')?.hasAttribute('hidden')).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('#table-heading'));
    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#success-step')?.hasAttribute('hidden')).toBe(false));

    const requests = actionCalls(fetch);
    const lookupRequest = requests[0][1];
    const seatRequest = requests[1][1];
    expect(requests.map((call) => call[0])).toEqual(['/player/check-in/lookup', '/player/check-in/seat']);
    expect(lookupRequest.headers['x-orbit-check-in-token']).toBe(capability);
    expect(seatRequest.headers['x-orbit-check-in-session']).toBe(sessionToken);
    expect(lookupRequest.body).not.toContain(capability);
    expect(seatRequest.body).not.toContain(sessionToken);
    expect(document.querySelector('#success-details')?.textContent).toContain('Table 1');
    expect(document.querySelector('#success-details')?.textContent).toContain('3');
    expect(document.querySelector('#success-details')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#player-greeting')?.textContent).toBe('');
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.activeElement).toBe(document.querySelector('#success-heading'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('accepts a privacy-safe generic already-seated lookup response', async () => {
    const fetch = installPage([
      jsonResponse({
        ok: true,
        status: 'already-seated',
        clubName: 'Orbit Room',
        message: 'You are already checked in. Please ask staff if you need help finding your seat.'
      })
    ]);

    await submitName();

    expect(actionCalls(fetch)).toHaveLength(1);
    expect(document.querySelector('#success-step')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#success-heading')?.textContent).toContain('already checked in');
    expect(document.querySelector('#success-message')?.textContent).toContain('ask staff');
    expect(document.querySelector('#success-details')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('#player-name')?.value).toBe('');
    expect(document.querySelector('#player-greeting')?.textContent).toBe('');
    expect(document.activeElement).toBe(document.querySelector('#success-heading'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('shows the terminal staff-assistance state without exposing roster details', async () => {
    const fetch = installPage([
      jsonResponse({
        ok: true,
        status: 'needs-assistance',
        clubName: 'Orbit Room',
        message: 'Club staff have been alerted. Please wait for someone to assist you.'
      }, 202)
    ]);

    await submitName('New Player');

    expect(actionCalls(fetch)).toHaveLength(1);
    expect(document.querySelector('#assistance-step')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#assistance-message')?.textContent).toContain('Club staff have been alerted');
    expect(document.querySelector('#player-name')?.value).toBe('');
    expect(document.querySelector('#player-greeting')?.textContent).toBe('');
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.body.textContent).not.toContain('New Player');
    expect(document.activeElement).toBe(document.querySelector('#assistance-heading'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('clears recognized player data when a refresh enters terminal assistance', async () => {
    const fetch = installPage([
      jsonResponse(recognizedPayload()),
      jsonResponse({ ok: false, code: 'CHECK_IN_TOKEN_REVOKED', error: 'This club check-in code is no longer active.' }, 410)
    ]);

    await submitName();
    document.querySelector('#refresh-button').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#assistance-step')?.hasAttribute('hidden')).toBe(false));

    expect(actionCalls(fetch)).toHaveLength(2);
    expect(document.querySelector('#player-name')?.value).toBe('');
    expect(document.querySelector('#player-greeting')?.textContent).toBe('');
    expect(document.querySelector('#table-club')?.textContent).toBe('');
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.body.textContent).not.toContain(recognizedPayload().playerName);
    expect(document.activeElement).toBe(document.querySelector('#assistance-heading'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('refreshes after a stale capacity response, obtains a new session, and seats at the replacement table', async () => {
    const replacementTable = availableTable({ id: 'table-two', label: 'Table 2', availableSeats: 1 });
    const fetch = installPage([
      jsonResponse(recognizedPayload({ tables: [availableTable({ availableSeats: 1 })] })),
      jsonResponse({
        ok: false,
        code: 'TABLE_UNAVAILABLE',
        error: 'That table is no longer available.',
        tables: [replacementTable]
      }, 409),
      jsonResponse(recognizedPayload({ sessionToken: refreshedSessionToken, tables: [replacementTable] })),
      jsonResponse({
        ok: true,
        status: 'seated',
        clubName: 'Orbit Room',
        playerName: 'José O’Brien',
        tableLabel: 'Table 2',
        gameName: '1/2 NLH',
        seatNumber: 5
      }, 201)
    ]);

    await submitName();
    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.table-choice-label')?.textContent).toBe('Table 2'));

    expect(document.querySelector('#table-status')?.textContent).toContain('Availability changed');
    expect(document.querySelector('#error-alert')?.textContent).toContain('no longer available');
    const firstLookupMutationId = JSON.parse(actionCalls(fetch)[0][1].body).mutationId;

    document.querySelector('#refresh-button').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(actionCalls(fetch)).toHaveLength(3));
    await vi.waitFor(() => expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false'));
    const refreshedLookupMutationId = JSON.parse(actionCalls(fetch)[2][1].body).mutationId;
    expect(refreshedLookupMutationId).not.toBe(firstLookupMutationId);
    expect(document.querySelector('#error-alert')?.hasAttribute('hidden')).toBe(true);

    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#success-step')?.hasAttribute('hidden')).toBe(false));

    const requests = actionCalls(fetch);
    expect(requests.map((call) => call[0])).toEqual([
      '/player/check-in/lookup',
      '/player/check-in/seat',
      '/player/check-in/lookup',
      '/player/check-in/seat'
    ]);
    expect(requests[3][1].headers['x-orbit-check-in-session']).toBe(refreshedSessionToken);
    expect(JSON.parse(requests[3][1].body)).toMatchObject({ tableId: 'table-two' });
    expect(document.querySelector('#success-table')?.textContent).toBe('Table 2');
    expect(document.querySelector('#success-seat')?.textContent).toBe('5');
  });

  it.each([
    ['omits replacement tables', {}],
    ['returns malformed replacement tables', { tables: [{ id: 'incomplete-table' }] }]
  ])('fails closed when a stale capacity response %s', async (_label, errorFields) => {
    const fetch = installPage([
      jsonResponse(recognizedPayload()),
      jsonResponse({ ok: false, code: 'TABLE_UNAVAILABLE', error: 'That table is no longer available.', ...errorFields }, 409)
    ]);

    await submitName();
    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false'));

    expect(actionCalls(fetch)).toHaveLength(2);
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.querySelector('#table-summary')?.textContent).toBe('');
    expect(document.querySelector('#table-status')?.textContent).toContain('Refresh the tables');
    expect(document.querySelector('#error-alert')?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(document.querySelector('#refresh-button'));
  });

  it('consults the session expiration before sending a seat request', async () => {
    const initialTime = Date.parse('2026-08-24T12:00:00.000Z');
    const now = vi.spyOn(Date, 'now').mockReturnValue(initialTime);
    const fetch = installPage([
      jsonResponse(recognizedPayload({ sessionExpiresAt: '2026-08-24T12:05:00.000Z' }))
    ]);

    await submitName();
    const tableButton = document.querySelector('.table-choice');
    expect(tableButton?.disabled).toBe(false);
    now.mockReturnValue(Date.parse('2026-08-24T12:06:00.000Z'));
    tableButton.dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));

    expect(actionCalls(fetch)).toHaveLength(1);
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.querySelector('#table-status')?.textContent).toContain('session expired');
    expect(document.activeElement).toBe(document.querySelector('#refresh-button'));
    expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false');
  });

  it('clears stale choices when the API rejects a seat session', async () => {
    const fetch = installPage([
      jsonResponse(recognizedPayload()),
      jsonResponse({ ok: false, code: 'CHECK_IN_TOKEN_EXPIRED', error: 'The check-in token expired.' }, 410)
    ]);

    await submitName();
    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#check-in-app')?.getAttribute('aria-busy')).toBe('false'));

    expect(actionCalls(fetch)).toHaveLength(2);
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.querySelector('#table-status')?.textContent).toContain('session expired');
    expect(document.activeElement).toBe(document.querySelector('#refresh-button'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBe(capability);
  });

  it.each([
    ['revokes the printed QR', 'CHECK_IN_TOKEN_REVOKED', 'This club check-in code is no longer active.'],
    ['deactivates the club license', 'PILOT_LICENSE_INACTIVE', 'Club self-check-in is not active.']
  ])('enters terminal assistance when seating %s', async (_label, code, error) => {
    const fetch = installPage([
      jsonResponse(recognizedPayload()),
      jsonResponse({ ok: false, code, error }, 410)
    ]);

    await submitName();
    document.querySelector('.table-choice').dispatchEvent(new BrowserMouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('#assistance-step')?.hasAttribute('hidden')).toBe(false));

    expect(actionCalls(fetch)).toHaveLength(2);
    expect(document.querySelector('#table-list')?.children).toHaveLength(0);
    expect(document.querySelector('#player-greeting')?.textContent).toBe('');
    expect(document.querySelector('#player-name')?.value).toBe('');
    expect(document.body.textContent).not.toContain(recognizedPayload().playerName);
    expect(document.querySelector('#assistance-message')?.textContent).toContain('staff member');
    expect(document.activeElement).toBe(document.querySelector('#assistance-heading'));
    expect(sessionStorage.getItem('orbit.selfCheckIn.capability')).toBeNull();
  });

  it('keeps invalid name errors associated with and focused on the input', async () => {
    const fetch = installPage([]);

    await submitName('###');

    const input = document.querySelector('#player-name');
    expect(actionCalls(fetch)).toHaveLength(0);
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(input?.getAttribute('aria-describedby')).toContain('name-error');
    expect(document.querySelector('#name-error')?.hasAttribute('hidden')).toBe(false);
    expect(document.querySelector('#lookup-status')?.getAttribute('role')).toBe('status');
    expect(document.querySelector('#error-alert')?.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(input);
  });
});
