'use strict';

(() => {
  const CAPABILITY_STORAGE_KEY = 'orbit.selfCheckIn.capability';
  const MAX_TOKEN_LENGTH = 4096;
  const MAX_DISPLAY_LENGTH = 160;
  const REQUEST_TIMEOUT_MS = 15_000;
  const sections = [];
  const flow = {
    capability: '',
    playerName: '',
    sessionToken: '',
    sessionExpiresAt: '',
    lookupMutationId: '',
    seatMutationId: '',
    selectedTableId: '',
    tables: [],
    busy: false
  };

  const elements = {
    app: document.querySelector('#check-in-app'),
    errorAlert: document.querySelector('#error-alert'),
    nameStep: document.querySelector('#name-step'),
    nameClub: document.querySelector('#name-club'),
    lookupForm: document.querySelector('#lookup-form'),
    playerName: document.querySelector('#player-name'),
    nameError: document.querySelector('#name-error'),
    lookupButton: document.querySelector('#lookup-button'),
    lookupStatus: document.querySelector('#lookup-status'),
    tableStep: document.querySelector('#table-step'),
    tableHeading: document.querySelector('#table-heading'),
    tableClub: document.querySelector('#table-club'),
    playerGreeting: document.querySelector('#player-greeting'),
    tableSummary: document.querySelector('#table-summary'),
    tableList: document.querySelector('#table-list'),
    emptyTables: document.querySelector('#empty-tables'),
    tableStatus: document.querySelector('#table-status'),
    refreshButton: document.querySelector('#refresh-button'),
    successStep: document.querySelector('#success-step'),
    successHeading: document.querySelector('#success-heading'),
    successClub: document.querySelector('#success-club'),
    successMessage: document.querySelector('#success-message'),
    successDetails: document.querySelector('#success-details'),
    successTableRow: document.querySelector('#success-table-row'),
    successTable: document.querySelector('#success-table'),
    successGameRow: document.querySelector('#success-game-row'),
    successGame: document.querySelector('#success-game'),
    successSeatRow: document.querySelector('#success-seat-row'),
    successSeat: document.querySelector('#success-seat'),
    successNextStep: document.querySelector('#success-step .next-step'),
    assistanceStep: document.querySelector('#assistance-step'),
    assistanceHeading: document.querySelector('#assistance-heading'),
    assistanceClub: document.querySelector('#assistance-club'),
    assistanceMessage: document.querySelector('#assistance-message')
  };

  sections.push(elements.nameStep, elements.tableStep, elements.successStep, elements.assistanceStep);

  class CheckInRequestError extends Error {
    constructor(message, status, code, payload) {
      super(message);
      this.name = 'CheckInRequestError';
      this.status = status;
      this.code = code;
      this.payload = payload;
    }
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function safeDisplayString(value, maximum = MAX_DISPLAY_LENGTH) {
    if (typeof value !== 'string') return '';
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum || /[\p{Cc}\p{Cf}]/u.test(normalized)) return '';
    return normalized;
  }

  function safeToken(value) {
    if (typeof value !== 'string') return '';
    if (value.length < 16 || value.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9._~-]+$/u.test(value)) return '';
    return value;
  }

  function safeIdentifier(value) {
    if (typeof value !== 'string' || value.length < 1 || value.length > 180) return '';
    return /^[A-Za-z0-9._:-]+$/u.test(value) ? value : '';
  }

  function safeSeatNumber(value) {
    return Number.isInteger(value) && value > 0 && value <= 100 ? value : null;
  }

  function hasCurrentSession() {
    const expiration = Date.parse(flow.sessionExpiresAt);
    return Boolean(flow.sessionToken) && Number.isFinite(expiration) && expiration > Date.now();
  }

  function createMutationId(prefix) {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
      return `${prefix}:${globalThis.crypto.randomUUID()}`;
    }
    const bytes = new Uint8Array(16);
    if (globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
      globalThis.crypto.getRandomValues(bytes);
      return `${prefix}:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
    }
    return `${prefix}:${Date.now().toString(36)}:${String(Math.random()).slice(2)}`;
  }

  function setBusy(busy, message = '') {
    flow.busy = busy;
    elements.app.setAttribute('aria-busy', String(busy));
    elements.lookupButton.disabled = busy;
    elements.refreshButton.disabled = busy;
    elements.playerName.disabled = busy;
    for (const button of elements.tableList.querySelectorAll('button')) button.disabled = busy || !hasCurrentSession();
    if (message) {
      if (!elements.nameStep.hidden) elements.lookupStatus.textContent = message;
      if (!elements.tableStep.hidden) elements.tableStatus.textContent = message;
    }
  }

  function clearError() {
    elements.errorAlert.textContent = '';
    elements.errorAlert.hidden = true;
  }

  function showError(message, focus = true) {
    const safeMessage = safeDisplayString(message, 240) || 'Something went wrong. Please try again.';
    elements.errorAlert.textContent = safeMessage;
    elements.errorAlert.hidden = false;
    if (focus) elements.errorAlert.focus();
  }

  function showSection(target, focusTarget) {
    for (const section of sections) section.hidden = section !== target;
    clearError();
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
  }

  function clearStoredCredentials() {
    flow.capability = '';
    flow.sessionToken = '';
    flow.sessionExpiresAt = '';
    try {
      sessionStorage.removeItem(CAPABILITY_STORAGE_KEY);
    } catch {
      // The terminal state is still safe when storage access is unavailable.
    }
  }

  function clearTableChoices() {
    flow.tables = [];
    elements.tableList.replaceChildren();
    elements.tableSummary.textContent = '';
    elements.emptyTables.hidden = true;
  }

  function clearTransientPlayerData() {
    flow.playerName = '';
    flow.lookupMutationId = '';
    flow.seatMutationId = '';
    flow.selectedTableId = '';
    elements.playerName.value = '';
    elements.nameClub.textContent = '';
    elements.nameClub.hidden = true;
    elements.lookupStatus.textContent = '';
    elements.tableClub.textContent = '';
    elements.playerGreeting.textContent = '';
    elements.tableStatus.textContent = '';
    clearTableChoices();
    clearFieldError();
  }

  function requireTableRefresh(message) {
    flow.sessionToken = '';
    flow.sessionExpiresAt = '';
    flow.seatMutationId = '';
    flow.selectedTableId = '';
    clearTableChoices();
    elements.tableStatus.textContent = message;
  }

  function readCapabilityFromFragment() {
    const fragment = window.location.hash;
    let fragmentCapability = '';

    if (fragment) {
      try {
        const fragmentParameters = new URLSearchParams(fragment.slice(1));
        fragmentCapability = safeToken(fragmentParameters.get('token'))
          || safeToken(fragmentParameters.get('capability'))
          || (!fragment.includes('=') ? safeToken(fragment.slice(1)) : '');
        if (fragmentCapability) {
          sessionStorage.setItem(CAPABILITY_STORAGE_KEY, fragmentCapability);
        } else {
          sessionStorage.removeItem(CAPABILITY_STORAGE_KEY);
        }
      } catch {
        // Storage can be unavailable in hardened browsers; the in-memory value can still be used.
      }

      try {
        window.history.replaceState(window.history.state, document.title, `${window.location.pathname}${window.location.search}`);
      } catch {
        window.location.hash = '';
      }
    }

    if (fragmentCapability) return fragmentCapability;
    try {
      return safeToken(sessionStorage.getItem(CAPABILITY_STORAGE_KEY));
    } catch {
      return '';
    }
  }

  function normalizeEnteredName(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
    if (normalized.length < 2 || normalized.length > 80) return '';
    if (/[\p{Cc}\p{Cf}]/u.test(normalized) || !/\p{L}/u.test(normalized)) return '';
    if (!/^[\p{L}\p{M}\p{N}\p{Zs}.'\u2019,-]+$/u.test(normalized)) return '';
    return normalized;
  }

  function parseTable(value) {
    if (!isRecord(value)) return null;
    const id = safeIdentifier(value.id);
    const gameId = safeIdentifier(value.gameId);
    const label = safeDisplayString(value.label, 120);
    const gameName = safeDisplayString(value.gameName, 120);
    const status = safeDisplayString(value.status, 32);
    const availableSeats = Number.isInteger(value.availableSeats) ? value.availableSeats : -1;
    const maxSeats = Number.isInteger(value.maxSeats) ? value.maxSeats : -1;
    if (!id || !gameId || !label || !gameName || !['Running', 'Forming'].includes(status)) return null;
    if (availableSeats < 1 || maxSeats < availableSeats || maxSeats > 100) return null;
    return { id, gameId, label, gameName, status, availableSeats, maxSeats };
  }

  function parseTables(value) {
    if (!Array.isArray(value) || value.length > 100) return null;
    const tables = value.map(parseTable);
    if (tables.some((table) => table === null)) return null;
    const identifiers = new Set(tables.map((table) => table.id));
    return identifiers.size === tables.length ? tables : null;
  }

  function parseContextResponse(payload) {
    if (!isRecord(payload) || payload.ok !== true || payload.status !== 'ready') return null;
    const clubName = safeDisplayString(payload.clubName, 120);
    return clubName ? { clubName } : null;
  }

  function parseLookupResponse(payload) {
    if (!isRecord(payload) || payload.ok !== true) return null;
    const clubName = safeDisplayString(payload.clubName, 120);
    if (!clubName) return null;

    if (payload.status === 'needs-assistance') {
      const message = safeDisplayString(payload.message, 240);
      return message ? { status: payload.status, clubName, message } : null;
    }

    if (payload.status === 'already-seated') {
      const message = safeDisplayString(payload.message, 240);
      return message ? { status: payload.status, clubName, message } : null;
    }

    if (payload.status !== 'recognized') return null;
    const playerName = safeDisplayString(payload.playerName, 120);
    const sessionToken = safeToken(payload.sessionToken);
    const sessionExpiresAt = safeDisplayString(payload.sessionExpiresAt, 64);
    const tables = parseTables(payload.tables);
    if (!playerName || !sessionToken || !sessionExpiresAt || Number.isNaN(Date.parse(sessionExpiresAt)) || tables === null) return null;
    return { status: payload.status, clubName, playerName, sessionToken, sessionExpiresAt, tables };
  }

  function parseSeatResponse(payload) {
    if (!isRecord(payload) || payload.ok !== true || !['seated', 'already-seated'].includes(payload.status)) return null;
    const clubName = safeDisplayString(payload.clubName, 120);
    const playerName = safeDisplayString(payload.playerName, 120);
    const tableLabel = safeDisplayString(payload.tableLabel, 120);
    const gameName = payload.status === 'seated' ? safeDisplayString(payload.gameName, 120) : '';
    const seatNumber = safeSeatNumber(payload.seatNumber);
    if (!clubName || !playerName || !tableLabel || (payload.status === 'seated' && !gameName) || seatNumber === null) return null;
    return { status: payload.status, clubName, playerName, tableLabel, gameName, seatNumber };
  }

  function parseErrorPayload(payload) {
    if (!isRecord(payload) || payload.ok !== false) return { code: '', error: '', tables: null };
    return {
      code: safeIdentifier(payload.code),
      error: safeDisplayString(payload.error, 240),
      tables: parseTables(payload.tables)
    };
  }

  async function postJson(path, headerName, token, body) {
    let response;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          [headerName]: token
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        credentials: 'same-origin',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
      });
    } catch {
      throw new CheckInRequestError('Unable to reach the club. Check your connection and try again.', 0, 'NETWORK_ERROR', null);
    } finally {
      window.clearTimeout(timeoutId);
    }

    let payload = null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const parsed = parseErrorPayload(payload);
      throw new CheckInRequestError(parsed.error || messageForError(parsed.code, response.status), response.status, parsed.code, payload);
    }
    return payload;
  }

  function messageForError(code, status) {
    if (code === 'NETWORK_ERROR' || status === 0) return 'Unable to reach the club. Check your connection and try again.';
    if (code === 'RATE_LIMITED' || status === 429) return 'Too many check-in attempts. Please wait a moment and try again.';
    if (['INVALID_CAPABILITY', 'INVALID_CHECK_IN_TOKEN', 'CHECK_IN_TOKEN_EXPIRED', 'CHECK_IN_TOKEN_REVOKED'].includes(code)) {
      return 'This QR check-in link is invalid or has expired. Please ask a staff member for help.';
    }
    if (code === 'PILOT_LICENSE_INACTIVE') return 'Self check-in is not active for this club. Please ask a staff member for help.';
    if (['INVALID_SESSION', 'CHECK_IN_SESSION_USED'].includes(code)) return 'Your check-in session expired. Refresh the tables and try again.';
    if (code === 'TABLE_UNAVAILABLE') return 'That table is no longer available. Choose another table or refresh the list.';
    if (code === 'CHECK_IN_UNAVAILABLE' || status >= 500) return 'Self check-in is temporarily unavailable. Please ask a staff member for help.';
    if (['INVALID_REQUEST', 'INVALID_INPUT', 'JSON_REQUIRED', 'UNSUPPORTED_MEDIA_TYPE'].includes(code) || status === 400 || status === 415) {
      return 'The check-in request was not accepted. Review your information and try again.';
    }
    return 'We could not complete check-in. Please try again or ask a staff member for help.';
  }

  function clearFieldError() {
    elements.nameError.textContent = '';
    elements.nameError.hidden = true;
    elements.playerName.removeAttribute('aria-invalid');
  }

  function setFieldError(message) {
    elements.nameError.textContent = message;
    elements.nameError.hidden = false;
    elements.playerName.setAttribute('aria-invalid', 'true');
    elements.playerName.focus();
  }

  function renderTables(tables) {
    flow.tables = tables;
    elements.tableList.replaceChildren();
    elements.emptyTables.hidden = tables.length > 0;
    elements.tableSummary.textContent = tables.length === 1
      ? '1 table has an available seat.'
      : `${tables.length} tables have available seats.`;

    for (const table of tables) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const main = document.createElement('span');
      const label = document.createElement('span');
      const game = document.createElement('span');
      const capacity = document.createElement('span');
      const action = document.createElement('span');

      button.type = 'button';
      button.className = 'table-choice';
      button.disabled = flow.busy || !hasCurrentSession();
      main.className = 'table-choice-main';
      label.className = 'table-choice-label';
      game.className = 'table-choice-game';
      capacity.className = 'table-choice-capacity';
      action.className = 'table-choice-action';
      action.setAttribute('aria-hidden', 'true');

      label.textContent = table.label;
      game.textContent = table.gameName;
      capacity.textContent = `${table.availableSeats} of ${table.maxSeats} seats available`;
      action.textContent = '\u2192';

      main.append(label, game, capacity);
      button.append(main, action);
      button.addEventListener('click', () => seatAtTable(table));
      item.append(button);
      elements.tableList.append(item);
    }
  }

  function showAssistance(clubName, message) {
    clearStoredCredentials();
    clearTransientPlayerData();
    elements.assistanceClub.textContent = clubName;
    elements.assistanceClub.hidden = !clubName;
    elements.assistanceMessage.textContent = safeDisplayString(message, 240) || 'A staff member will help you finish checking in.';
    showSection(elements.assistanceStep, elements.assistanceHeading);
  }

  function setOptionalResult(row, target, value) {
    const safeValue = safeDisplayString(value, 120);
    row.hidden = !safeValue;
    target.textContent = safeValue;
  }

  function showSuccess(result, alreadySeated = false) {
    clearStoredCredentials();
    clearTransientPlayerData();
    elements.successClub.textContent = result.clubName;
    elements.successHeading.textContent = alreadySeated ? "You're already checked in" : 'Checked in';
    elements.successMessage.textContent = alreadySeated
      ? safeDisplayString(result.message, 240)
        || (safeDisplayString(result.playerName, 120) ? `${result.playerName}, your seat is already ready.` : 'You are already checked in.')
      : `${result.playerName}, seat ready.`;
    setOptionalResult(elements.successTableRow, elements.successTable, result.tableLabel);
    setOptionalResult(elements.successGameRow, elements.successGame, result.gameName);
    const seatNumber = safeSeatNumber(result.seatNumber);
    elements.successSeatRow.hidden = seatNumber === null;
    elements.successSeat.textContent = seatNumber === null ? '' : String(seatNumber);
    elements.successDetails.hidden = elements.successTableRow.hidden
      && elements.successGameRow.hidden
      && elements.successSeatRow.hidden;
    elements.successNextStep.textContent = alreadySeated
      ? 'See staff if you need help.'
      : 'Head to your table.';
    showSection(elements.successStep, elements.successHeading);
  }

  async function lookupPlayer(options = {}) {
    if (flow.busy) return;
    const playerName = options.useStoredName ? flow.playerName : normalizeEnteredName(elements.playerName.value);
    if (!playerName) {
      setFieldError('Enter your full name using 2 to 80 valid characters.');
      return;
    }
    if (!flow.capability) {
      showAssistance('', 'This QR check-in link is unavailable. Please ask a staff member for help.');
      return;
    }

    clearFieldError();
    clearError();
    flow.playerName = playerName;
    if (options.freshMutation || !flow.lookupMutationId) flow.lookupMutationId = createMutationId('lookup');
    setBusy(true, options.useStoredName ? 'Refreshing live table availability...' : 'Looking for your club profile...');

    let focusRefreshAfterRequest = false;
    try {
      const payload = await postJson('/player/check-in/lookup', 'x-orbit-check-in-token', flow.capability, {
        name: playerName,
        mutationId: flow.lookupMutationId
      });
      const result = parseLookupResponse(payload);
      if (!result) throw new CheckInRequestError('The club returned an unexpected response. Please ask a staff member for help.', 0, 'INVALID_RESPONSE', payload);

      if (result.status === 'needs-assistance') {
        showAssistance(result.clubName, result.message);
        return;
      }
      if (result.status === 'already-seated') {
        showSuccess(result, true);
        return;
      }

      flow.playerName = result.playerName;
      flow.sessionToken = result.sessionToken;
      flow.sessionExpiresAt = result.sessionExpiresAt;
      flow.seatMutationId = '';
      flow.selectedTableId = '';
      elements.tableClub.textContent = result.clubName;
      elements.playerGreeting.textContent = result.playerName;
      showSection(elements.tableStep, elements.tableHeading);
      if (!hasCurrentSession()) {
        const message = 'Your check-in session expired. Refresh the tables to continue.';
        requireTableRefresh(message);
        showError(message, false);
        focusRefreshAfterRequest = true;
        return;
      }
      elements.tableStatus.textContent = result.tables.length ? 'Live availability refreshed.' : 'No open seats found. You can refresh the list.';
      renderTables(result.tables);
    } catch (error) {
      const requestError = error instanceof CheckInRequestError ? error : null;
      const message = requestError ? messageForError(requestError.code, requestError.status) : '';
      showError(message || safeDisplayString(error && error.message, 240), true);
      if (requestError && (
        ['INVALID_CAPABILITY', 'INVALID_CHECK_IN_TOKEN', 'CHECK_IN_TOKEN_EXPIRED', 'CHECK_IN_TOKEN_REVOKED'].includes(requestError.code)
        || requestError.status === 401
        || requestError.status === 410
      )) {
        clearStoredCredentials();
        showAssistance('', messageForError('INVALID_CAPABILITY', 401));
        return;
      }
      if (options.useStoredName) {
        elements.tableStatus.textContent = 'Live availability could not be refreshed.';
      } else {
        elements.lookupStatus.textContent = 'Profile lookup did not complete.';
      }
    } finally {
      setBusy(false);
      if (focusRefreshAfterRequest) requestAnimationFrame(() => elements.refreshButton.focus());
    }
  }

  async function seatAtTable(table) {
    if (flow.busy) return;
    if (!hasCurrentSession()) {
      const message = 'Your check-in session expired. Refresh the tables to continue.';
      requireTableRefresh(message);
      showError(message, false);
      requestAnimationFrame(() => elements.refreshButton.focus());
      return;
    }
    if (flow.selectedTableId !== table.id || !flow.seatMutationId) {
      flow.selectedTableId = table.id;
      flow.seatMutationId = createMutationId('seat');
    }

    clearError();
    setBusy(true, `Checking availability at ${table.label}...`);
    let focusRefreshAfterRequest = false;
    try {
      const payload = await postJson('/player/check-in/seat', 'x-orbit-check-in-session', flow.sessionToken, {
        tableId: table.id,
        mutationId: flow.seatMutationId
      });
      const result = parseSeatResponse(payload);
      if (!result) throw new CheckInRequestError('The club returned an unexpected response. Please ask a staff member for help.', 0, 'INVALID_RESPONSE', payload);
      showSuccess(result, result.status === 'already-seated');
    } catch (error) {
      const requestError = error instanceof CheckInRequestError ? error : null;
      const sessionFailure = Boolean(requestError) && [
        'INVALID_SESSION',
        'INVALID_CHECK_IN_TOKEN',
        'CHECK_IN_TOKEN_EXPIRED',
        'CHECK_IN_SESSION_USED'
      ].includes(requestError.code);
      const terminalAccessFailure = Boolean(requestError) && [
        'CHECK_IN_TOKEN_REVOKED',
        'PILOT_LICENSE_INACTIVE'
      ].includes(requestError.code);
      if (terminalAccessFailure) {
        showAssistance('', messageForError(requestError.code, requestError.status));
      } else if (requestError && requestError.code === 'TABLE_UNAVAILABLE') {
        const parsedError = parseErrorPayload(requestError.payload);
        if (parsedError.tables === null) {
          requireTableRefresh('Availability changed. Refresh the tables to continue.');
          focusRefreshAfterRequest = true;
        } else {
          renderTables(parsedError.tables);
          elements.tableStatus.textContent = 'Availability changed. Choose another table or refresh for a new check-in session.';
        }
      } else if (sessionFailure) {
        requireTableRefresh('Your check-in session expired. Refresh the tables to continue.');
        focusRefreshAfterRequest = true;
      } else {
        elements.tableStatus.textContent = 'Your seat was not assigned.';
      }
      const message = requestError
        ? messageForError(sessionFailure ? 'INVALID_SESSION' : requestError.code, requestError.status)
        : '';
      if (!terminalAccessFailure) showError(message || safeDisplayString(error && error.message, 240), !focusRefreshAfterRequest);
    } finally {
      setBusy(false);
      if (focusRefreshAfterRequest) requestAnimationFrame(() => elements.refreshButton.focus());
    }
  }

  elements.lookupForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const enteredName = normalizeEnteredName(elements.playerName.value);
    if (enteredName !== flow.playerName) flow.lookupMutationId = '';
    void lookupPlayer();
  });

  elements.playerName.addEventListener('input', () => {
    clearFieldError();
    elements.lookupStatus.textContent = '';
  });

  elements.refreshButton.addEventListener('click', () => {
    void lookupPlayer({ useStoredName: true, freshMutation: true });
  });

  async function initializeClubContext() {
    if (!flow.capability) {
      showAssistance('', 'This QR check-in link is unavailable. Please ask a staff member for help.');
      return;
    }

    elements.app.setAttribute('aria-busy', 'true');
    try {
      const payload = await postJson('/player/check-in/context', 'x-orbit-check-in-token', flow.capability, {});
      const context = parseContextResponse(payload);
      if (!context) {
        throw new CheckInRequestError(
          'The club returned an unexpected response. Please ask a staff member for help.',
          0,
          'INVALID_RESPONSE',
          payload
        );
      }
      elements.nameClub.textContent = context.clubName;
      elements.nameClub.hidden = false;
      elements.app.setAttribute('aria-busy', 'false');
      showSection(elements.nameStep, elements.playerName);
    } catch (error) {
      elements.app.setAttribute('aria-busy', 'false');
      const requestError = error instanceof CheckInRequestError ? error : null;
      const message = requestError
        ? messageForError(requestError.code, requestError.status)
        : safeDisplayString(error && error.message, 240);
      clearStoredCredentials();
      showAssistance('', message || 'Self check-in is unavailable. Please ask a staff member for help.');
    }
  }

  flow.capability = readCapabilityFromFragment();
  void initializeClubContext();
})();
