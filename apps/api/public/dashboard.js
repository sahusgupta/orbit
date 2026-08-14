const state = {
  source: null,
  events: [],
  totalEvents: 0,
  eventHistoryHasMore: false,
  eventHistoryLoading: false,
  errors: [],
  clients: [],
  venues: [],
  licenses: [],
  managementAccounts: [],
  securityEvents: []
};

const elements = {
  form: document.querySelector('#key-form'),
  key: document.querySelector('#api-key'),
  status: document.querySelector('#status'),
  events: document.querySelector('#events'),
  errors: document.querySelector('#errors'),
  clients: document.querySelector('#clients'),
  venues: document.querySelector('#venues'),
  licenses: document.querySelector('#licenses'),
  managementAccounts: document.querySelector('#management-accounts'),
  securityEvents: document.querySelector('#security-events'),
  eventCount: document.querySelector('#event-count'),
  eventHistoryStatus: document.querySelector('#event-history-status'),
  errorCount: document.querySelector('#error-count'),
  clientCount: document.querySelector('#client-count'),
  venueCount: document.querySelector('#venue-count'),
  licenseCount: document.querySelector('#license-count'),
  managementAccountCount: document.querySelector('#management-account-count'),
  securityEventCount: document.querySelector('#security-event-count'),
  metricClients: document.querySelector('#metric-clients'),
  metricActive: document.querySelector('#metric-active'),
  metricEvents: document.querySelector('#metric-events'),
  metricErrors: document.querySelector('#metric-errors'),
  metricTables: document.querySelector('#metric-tables'),
  metricLicenses: document.querySelector('#metric-licenses')
};

let renderedManagementAccounts = null;
let renderedManagementLicenses = null;
let renderedSecurityEvents = null;

function setStatus(message, tone = '') {
  elements.status.textContent = message;
  elements.status.className = `status ${tone}`.trim();
}

function formatTime(value) {
  return value ? new Date(value).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeDetails(value) {
  if (!value) return '';
  try {
    return escapeHtml(JSON.stringify(value, null, 2));
  } catch {
    return escapeHtml(String(value));
  }
}

function renderList(target, items, renderItem, emptyText) {
  target.classList.toggle('empty', !items.length);
  target.innerHTML = items.length ? items.map(renderItem).join('') : emptyText;
}

function renderManagementAccessControls(accountKey, account, license) {
  const escapedAccountKey = escapeHtml(accountKey);
  if (!account?.hasManagementLogin) {
    if (!license || license.status !== 'active') {
      return '<p class="account-warning">A management login can be created only while the linked pilot key is active.</p>';
    }
    const escapedLicenseId = escapeHtml(license.id);
    return `
      <div class="account-controls single" data-account-control-scope="${escapedAccountKey}">
        <section class="account-control-group">
          <div>
            <strong>Create management login</strong>
            <p>Add credentials to this active key's existing authoritative club account. Games, players, sessions, and settings stay attached to the same account key.</p>
          </div>
          <div class="account-action-row">
            <label>
              <span>Login email</span>
              <input data-account-username="${escapedAccountKey}" type="email" maxlength="254" autocomplete="off" placeholder="manager@example.com" />
            </label>
            <label>
              <span>Temporary password</span>
              <input data-account-password="${escapedAccountKey}" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="12-128 characters" />
            </label>
            <label>
              <span>Confirm password</span>
              <input data-account-password-confirm="${escapedAccountKey}" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="Repeat password" />
            </label>
            <button type="button" data-account-action="create-login" data-account-key="${escapedAccountKey}" data-license-id="${escapedLicenseId}">Create login</button>
          </div>
        </section>
      </div>
    `;
  }
  const recoveryActive = account.recovery?.status === 'active';
  return `
    <div class="account-controls" data-account-control-scope="${escapedAccountKey}">
      <section class="account-control-group">
        <div>
          <strong>Owner-assisted recovery</strong>
          <p>Lets this venue use its current pilot key to establish one new password before the window expires.</p>
        </div>
        <div class="account-action-row">
          <label>
            <span>Window</span>
            <select data-account-duration="${escapedAccountKey}">
              <option value="15">15 minutes</option>
              <option value="30" selected>30 minutes</option>
              <option value="60">60 minutes</option>
            </select>
          </label>
          <label class="reason-field">
            <span>Support note (optional)</span>
            <input data-account-reason="${escapedAccountKey}" maxlength="200" placeholder="Why recovery was approved" />
          </label>
          ${recoveryActive
            ? `<button type="button" class="danger" data-account-action="cancel-recovery" data-account-key="${escapedAccountKey}">Cancel override</button>`
            : `<button type="button" data-account-action="start-recovery" data-account-key="${escapedAccountKey}">Start override</button>`}
          <button type="button" class="secondary" data-account-action="send-reset-email" data-account-key="${escapedAccountKey}">Send reset email</button>
        </div>
      </section>
      <section class="account-control-group">
        <div>
          <strong>Set a new password</strong>
          <p>Immediately replaces the Firebase and authoritative Orbit management password and revokes existing Firebase sessions. Share a temporary password through a separate secure channel.</p>
        </div>
        <div class="account-action-row">
          <label>
            <span>New password</span>
            <input data-account-password="${escapedAccountKey}" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="12-128 characters" />
          </label>
          <label>
            <span>Confirm password</span>
            <input data-account-password-confirm="${escapedAccountKey}" type="password" minlength="12" maxlength="128" autocomplete="new-password" placeholder="Repeat password" />
          </label>
          <button type="button" class="danger-solid" data-account-action="change-password" data-account-key="${escapedAccountKey}">Set password</button>
        </div>
      </section>
    </div>
  `;
}

function render() {
  elements.eventCount.textContent = state.totalEvents > state.events.length
    ? `${state.events.length} / ${state.totalEvents}`
    : String(state.events.length);
  elements.eventHistoryStatus.hidden = !state.eventHistoryLoading && !state.eventHistoryHasMore;
  elements.eventHistoryStatus.textContent = state.eventHistoryLoading
    ? 'Loading earlier events…'
    : state.eventHistoryHasMore
      ? 'Scroll for earlier events'
      : 'Complete event history loaded';
  elements.errorCount.textContent = String(state.errors.length);
  elements.clientCount.textContent = String(state.clients.length);
  elements.venueCount.textContent = String(state.venues.length);
  elements.licenseCount.textContent = String(state.licenses.length);
  elements.managementAccountCount.textContent = String(state.managementAccounts.length);
  elements.securityEventCount.textContent = String(state.securityEvents.length);
  elements.metricLicenses.textContent = String(state.licenses.filter((license) => license.status === 'active').length);

  renderList(
    elements.licenses,
    state.licenses,
    (license) => {
      const account = state.managementAccounts.find((candidate) => candidate.accountKey === license.accountKey);
      return `
        <article class="license-row ${escapeHtml(license.status)}">
          <div class="license-main">
            <div>
              <strong>${escapeHtml(license.issuedTo || license.licenseId)}</strong>
              <div class="meta">
                <span>${escapeHtml(license.licenseId)}</span>
                <span>key ending ${escapeHtml(license.codeLast4 || '----')}</span>
                <span>last used ${escapeHtml(formatTime(license.lastAuthenticatedAt) || 'never')}</span>
              </div>
            </div>
            <span class="license-status ${escapeHtml(license.status)}">${escapeHtml(license.status)}</span>
          </div>
          <div class="license-renewal">
            <label>
              <span>Valid through</span>
              <input data-license-expiration="${escapeHtml(license.id)}" type="date" value="${escapeHtml(String(license.expiresAt || '').slice(0, 10))}" />
            </label>
            <button type="button" data-license-action="renew-date" data-license-id="${escapeHtml(license.id)}">Save date</button>
            <button type="button" class="secondary" data-license-action="extend" data-license-days="30" data-license-id="${escapeHtml(license.id)}">+30 days</button>
            <button type="button" class="secondary" data-license-action="extend" data-license-days="90" data-license-id="${escapeHtml(license.id)}">+90 days</button>
            ${license.status !== 'revoked' ? `<button type="button" class="danger" data-license-action="revoke" data-license-id="${escapeHtml(license.id)}">Revoke</button>` : ''}
          </div>
          ${license.status === 'active' ? `
            <section class="license-account-access" data-active-license-account-controls="${escapeHtml(license.accountKey)}">
              <div>
                <strong>Management access for this active key</strong>
                <p>${account?.username ? escapeHtml(account.username) : 'No management login is linked to this key yet.'}</p>
              </div>
              ${renderManagementAccessControls(license.accountKey, account, license)}
            </section>
          ` : ''}
        </article>
      `;
    },
    'No managed pilot licenses yet. Provision a verified signed key through the protected license endpoint.'
  );

  if (renderedManagementAccounts !== state.managementAccounts || renderedManagementLicenses !== state.licenses) {
    renderList(
      elements.managementAccounts,
      state.managementAccounts,
    (account) => {
      const license = state.licenses.find((candidate) => candidate.accountKey === account.accountKey);
      const recovery = account.recovery;
      const recoveryActive = recovery?.status === 'active';
      const loginActions = renderManagementAccessControls(account.accountKey, account, license);
      return `
        <article class="management-account-row">
          <div class="account-heading">
            <div>
              <strong>${escapeHtml(account.venueName || account.accountKey)}</strong>
              <div class="meta">
                <span>${escapeHtml(account.username || 'No management email')}</span>
                <span>${escapeHtml(account.accountKey)}</span>
                <span>state revision ${escapeHtml(account.revision)}</span>
                <span>${license ? `pilot key ${escapeHtml(license.status)}` : 'no managed pilot key found'}</span>
              </div>
            </div>
            <span class="recovery-status ${recoveryActive ? 'active' : ''}">
              ${recoveryActive ? `recovery until ${escapeHtml(formatTime(recovery.expiresAt))}` : escapeHtml(recovery?.status || 'no recovery override')}
            </span>
          </div>
          ${loginActions}
        </article>
      `;
    },
      'No management accounts have been committed to the authoritative datastore.'
    );
    renderedManagementAccounts = state.managementAccounts;
    renderedManagementLicenses = state.licenses;
  }

  if (renderedSecurityEvents !== state.securityEvents) {
    renderList(
      elements.securityEvents,
      state.securityEvents,
    (securityEvent) => `
      <article class="item security-item">
        <strong>${escapeHtml(securityEvent.event)}</strong>
        <div class="meta">
          <span>${escapeHtml(formatTime(securityEvent.occurredAt))}</span>
          <span>${escapeHtml(securityEvent.accountKey)}</span>
          <span>${escapeHtml(securityEvent.actorRef)}</span>
        </div>
        ${securityEvent.details ? `<pre class="details">${safeDetails(securityEvent.details)}</pre>` : ''}
      </article>
    `,
      'No management security activity has been recorded.'
    );
    renderedSecurityEvents = state.securityEvents;
  }

  renderList(
    elements.errors,
    state.errors,
    (error) => `
      <article class="item error-item">
        <strong>${escapeHtml(error.message)}</strong>
        <div class="meta">
          <span>${escapeHtml(formatTime(error.occurredAt))}</span>
          <span>${escapeHtml(error.venueId)}</span>
          <span>${escapeHtml(error.deviceName || error.deviceId)}</span>
          <span>${escapeHtml(error.source || 'renderer')}</span>
          <span>${escapeHtml(error.route || 'unknown route')}</span>
        </div>
        ${error.stack ? `<pre class="details">${escapeHtml(error.stack)}</pre>` : ''}
      </article>
    `,
    'No errors received.'
  );

  renderList(
    elements.events,
    state.events,
    (event) => `
      <article class="item usage-item">
        <strong>${escapeHtml(event.event)}</strong>
        <div class="meta">
          <span>${escapeHtml(formatTime(event.occurredAt))}</span>
          <span>${escapeHtml(event.category)}</span>
          <span>${escapeHtml(event.venueId)}</span>
          <span>${escapeHtml(event.route || 'app')}</span>
        </div>
        ${event.details ? `<pre class="details">${safeDetails(event.details)}</pre>` : ''}
      </article>
    `,
    'No events received.'
  );

  renderList(
    elements.clients,
    state.clients,
    (client) => `
      <article class="row">
        <strong>${escapeHtml(client.deviceName || client.deviceId)}</strong>
        <div class="meta">
          <span>${escapeHtml(client.venueName || client.venueId)}</span>
          <span>${escapeHtml(client.appVersion)}</span>
          <span>${escapeHtml(client.platform)}</span>
          <span>seen ${escapeHtml(formatTime(client.lastSeenAt))}</span>
          <span>${escapeHtml(client.updateStatus || 'no update status')}</span>
        </div>
        ${client.lastError ? `<pre class="details">${escapeHtml(client.lastError)}</pre>` : ''}
      </article>
    `,
    'No clients yet.'
  );

  renderList(
    elements.venues,
    state.venues,
    (venue) => `
      <article class="row">
        <strong>${escapeHtml(venue.venueName || venue.venueId)}</strong>
        <div class="meta">
          <span>${escapeHtml(venue.venueId)}</span>
          <span>${escapeHtml(venue.clientCount)} client(s)</span>
          <span>saved ${escapeHtml(formatTime(venue.savedAt))}</span>
        </div>
      </article>
    `,
    'No venues yet.'
  );
}

function setSummary(summary) {
  elements.metricClients.textContent = String(summary.clients || 0);
  elements.metricActive.textContent = String(summary.activeClients24h || 0);
  elements.metricEvents.textContent = String(summary.events || 0);
  state.totalEvents = Number(summary.events || 0);
  elements.metricErrors.textContent = String(summary.errors || 0);
  elements.metricTables.textContent = String(summary.tableStarts24h || 0);
}

async function loadDashboard({ preserveEventHistory = false } = {}) {
  const response = await fetch('/dashboard/data', { credentials: 'same-origin' });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `API returned ${response.status}`);
  const latestEvents = payload.events || [];
  if (preserveEventHistory && state.events.length) {
    const latestIds = new Set(latestEvents.map((event) => event.id));
    state.events = [...latestEvents, ...state.events.filter((event) => !latestIds.has(event.id))];
  } else {
    state.events = latestEvents;
    state.eventHistoryHasMore = Boolean(payload.eventHistory?.hasMore);
  }
  state.errors = payload.errors || [];
  state.clients = payload.clients || [];
  state.venues = payload.venues || [];
  state.licenses = payload.licenses || [];
  state.managementAccounts = payload.managementAccounts || [];
  state.securityEvents = payload.securityEvents || [];
  setSummary(payload.summary || {});
  render();
}

async function loadEarlierEvents() {
  if (state.eventHistoryLoading || !state.eventHistoryHasMore || !state.events.length) return;
  state.eventHistoryLoading = true;
  render();
  const oldest = state.events[state.events.length - 1];
  try {
    const query = new URLSearchParams({
      limit: '100',
      beforeOccurredAt: oldest.occurredAt,
      beforeId: String(oldest.id)
    });
    const response = await fetch(`/dashboard/history/events?${query}`, { credentials: 'same-origin' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `API returned ${response.status}`);
    const knownIds = new Set(state.events.map((event) => event.id));
    state.events = [...state.events, ...(payload.events || []).filter((event) => !knownIds.has(event.id))];
    state.eventHistoryHasMore = Boolean(payload.hasMore);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to load earlier events.', 'error');
  } finally {
    state.eventHistoryLoading = false;
    render();
  }
}

function connectLive() {
  if (state.source) state.source.close();
  state.source = new EventSource('/dashboard/events');
  state.source.addEventListener('ready', () => {
    setStatus('Live dashboard connected.', 'live');
    loadDashboard({ preserveEventHistory: true }).catch(() => undefined);
  });
  state.source.addEventListener('replay-reset', () => {
    loadDashboard({ preserveEventHistory: true }).catch(() => undefined);
  });
  state.source.addEventListener('telemetry', (message) => {
    const event = JSON.parse(message.data);
    if (!state.events.some((existing) => existing.id === event.id)) {
      state.events = [event, ...state.events];
      state.totalEvents += 1;
    }
    render();
  });
  state.source.addEventListener('error', (message) => {
    if (message.data) {
      state.errors = [JSON.parse(message.data), ...state.errors].slice(0, 100);
      loadDashboard({ preserveEventHistory: true }).catch(() => render());
      return;
    }
    setStatus('Live stream disconnected. Reconnecting...', 'error');
  });
  state.source.addEventListener('client', () => {
    loadDashboard({ preserveEventHistory: true }).catch(() => undefined);
  });
}

async function connect(password) {
  setStatus('Signing in...');
  try {
    const sessionResponse = await fetch('/dashboard/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const sessionPayload = await sessionResponse.json();
    if (!sessionResponse.ok || !sessionPayload.ok) throw new Error(sessionPayload.error || 'Dashboard sign-in failed.');
    elements.key.value = '';
    await loadDashboard();
    connectLive();
    setStatus('Live dashboard connected.', 'live');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to connect.', 'error');
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  connect(elements.key.value);
});

elements.events.addEventListener('scroll', () => {
  const remaining = elements.events.scrollHeight - elements.events.scrollTop - elements.events.clientHeight;
  if (remaining < 160) void loadEarlierEvents();
});

elements.licenses.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-license-action]');
  if (!button) return;
  const id = button.dataset.licenseId;
  const action = button.dataset.licenseAction;
  if (!id || !action) return;
  if (action === 'revoke' && !window.confirm('Revoke this pilot license immediately?')) return;
  const expirationInput = elements.licenses.querySelector(`[data-license-expiration="${id}"]`);
  const body = action === 'renew-date'
    ? { expiresAt: expirationInput?.value }
    : action === 'extend'
      ? { extendDays: Number(button.dataset.licenseDays) }
      : {};
  button.disabled = true;
  setStatus(action === 'revoke' ? 'Revoking pilot license...' : 'Renewing pilot license...');
  try {
    const response = await fetch(`/dashboard/licenses/${encodeURIComponent(id)}/${action === 'revoke' ? 'revoke' : 'renew'}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-orbit-csrf': '1' },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `API returned ${response.status}`);
    await loadDashboard();
    setStatus(action === 'revoke' ? 'Pilot license revoked.' : 'Pilot license renewed. Clients will refresh automatically.', 'live');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'License update failed.', 'error');
    button.disabled = false;
  }
});

async function handleManagementAccountAction(event, container) {
  const button = event.target.closest('[data-account-action]');
  if (!button) return;
  const accountKey = button.dataset.accountKey;
  const action = button.dataset.accountAction;
  if (!accountKey || !action) return;

  const controlScope = button.closest('[data-account-control-scope]') || container;
  const usernameInput = controlScope.querySelector('[data-account-username]');
  const passwordInput = controlScope.querySelector('[data-account-password]');
  const confirmationInput = controlScope.querySelector('[data-account-password-confirm]');
  const durationInput = controlScope.querySelector('[data-account-duration]');
  const reasonInput = controlScope.querySelector('[data-account-reason]');
  let method = 'POST';
  let pathname = `/dashboard/management-accounts/${encodeURIComponent(accountKey)}`;
  let body = {};
  let pendingMessage = '';
  let successMessage = '';

  if (action === 'create-login') {
    const licenseId = button.dataset.licenseId;
    const username = usernameInput?.value.trim().toLowerCase() || '';
    const password = passwordInput?.value || '';
    if (!licenseId) return;
    if (!/^\S+@\S+\.\S+$/.test(username)) {
      setStatus('Enter a valid management login email.', 'error');
      usernameInput?.focus();
      return;
    }
    if (password.length < 12 || password.length > 128) {
      setStatus('The temporary password must be between 12 and 128 characters.', 'error');
      passwordInput?.focus();
      return;
    }
    if (password !== confirmationInput?.value) {
      setStatus('The password and confirmation do not match.', 'error');
      confirmationInput?.focus();
      return;
    }
    if (!window.confirm('Create this management login for the active pilot key? Existing club data will remain attached to the same account.')) return;
    pathname = `/dashboard/licenses/${encodeURIComponent(licenseId)}/management-account`;
    body = { username, password };
    pendingMessage = 'Creating management login...';
    successMessage = 'Management login created without replacing the club data. Share the credentials and pilot key through separate secure channels.';
  } else if (action === 'start-recovery') {
    if (!window.confirm('Open a single-use recovery window? Anyone holding this venue’s current pilot key can establish one new management password until the window expires.')) return;
    pathname += '/recovery';
    body = { durationMinutes: Number(durationInput?.value || 30), reason: reasonInput?.value || '' };
    pendingMessage = 'Starting owner-assisted recovery...';
    successMessage = 'Recovery override started. Tell the card house to load its current key and choose Owner-assisted recovery.';
  } else if (action === 'cancel-recovery') {
    if (!window.confirm('Cancel this recovery override immediately?')) return;
    pathname += '/recovery';
    method = 'DELETE';
    pendingMessage = 'Canceling recovery override...';
    successMessage = 'Recovery override canceled.';
  } else if (action === 'send-reset-email') {
    if (!window.confirm('Send a Firebase password-reset email to this management login? Keep a recovery override active so the card house can update Orbit after using the email.')) return;
    pathname += '/password-reset-email';
    pendingMessage = 'Requesting Firebase password-reset email...';
    successMessage = 'Firebase accepted the password-reset email request. Orbit recorded the request; final delivery remains provider-managed.';
  } else if (action === 'change-password') {
    const password = passwordInput?.value || '';
    if (password.length < 12 || password.length > 128) {
      setStatus('The new management password must be between 12 and 128 characters.', 'error');
      passwordInput?.focus();
      return;
    }
    if (password !== confirmationInput?.value) {
      setStatus('The new password and confirmation do not match.', 'error');
      confirmationInput?.focus();
      return;
    }
    if (!window.confirm('Change this card house management password now? Existing Firebase sessions will be revoked. This cannot reveal or restore the old password.')) return;
    pathname += '/password';
    body = { password };
    passwordInput.value = '';
    confirmationInput.value = '';
    pendingMessage = 'Changing management password...';
    successMessage = 'Management password changed in Firebase and the authoritative Orbit state. Share it through a separate secure channel.';
  } else {
    return;
  }

  button.disabled = true;
  setStatus(pendingMessage);
  try {
    const response = await fetch(pathname, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-orbit-csrf': '1' },
      body: method === 'DELETE' ? undefined : JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || `API returned ${response.status}`);
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (confirmationInput) confirmationInput.value = '';
    await loadDashboard();
    setStatus(successMessage, 'live');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Management account action failed.', 'error');
    button.disabled = false;
  }
}

elements.managementAccounts.addEventListener('click', (event) => {
  void handleManagementAccountAction(event, elements.managementAccounts);
});

elements.licenses.addEventListener('click', (event) => {
  void handleManagementAccountAction(event, elements.licenses);
});

loadDashboard()
  .then(() => {
    connectLive();
    setStatus('Live dashboard connected.', 'live');
  })
  .catch(() => setStatus('Sign in to load the dashboard.'));
