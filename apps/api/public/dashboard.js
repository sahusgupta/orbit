const state = {
  apiKey: localStorage.getItem('orbit-dashboard-api-key') || '',
  source: null,
  events: [],
  errors: [],
  clients: [],
  venues: []
};

const elements = {
  form: document.querySelector('#key-form'),
  key: document.querySelector('#api-key'),
  status: document.querySelector('#status'),
  events: document.querySelector('#events'),
  errors: document.querySelector('#errors'),
  clients: document.querySelector('#clients'),
  venues: document.querySelector('#venues'),
  eventCount: document.querySelector('#event-count'),
  errorCount: document.querySelector('#error-count'),
  clientCount: document.querySelector('#client-count'),
  venueCount: document.querySelector('#venue-count'),
  metricClients: document.querySelector('#metric-clients'),
  metricActive: document.querySelector('#metric-active'),
  metricEvents: document.querySelector('#metric-events'),
  metricErrors: document.querySelector('#metric-errors'),
  metricTables: document.querySelector('#metric-tables')
};

elements.key.value = state.apiKey;

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

function render() {
  elements.eventCount.textContent = String(state.events.length);
  elements.errorCount.textContent = String(state.errors.length);
  elements.clientCount.textContent = String(state.clients.length);
  elements.venueCount.textContent = String(state.venues.length);

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
  elements.metricErrors.textContent = String(summary.errors || 0);
  elements.metricTables.textContent = String(summary.tableStarts24h || 0);
}

async function loadDashboard() {
  if (!state.apiKey) {
    setStatus('Enter the same ORBIT_CLIENT_API_KEY used by the API.');
    return;
  }
  const response = await fetch('/dashboard/data', { headers: { 'x-orbit-api-key': state.apiKey } });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || `API returned ${response.status}`);
  state.events = payload.events || [];
  state.errors = payload.errors || [];
  state.clients = payload.clients || [];
  state.venues = payload.venues || [];
  setSummary(payload.summary || {});
  render();
}

function connectLive() {
  if (state.source) state.source.close();
  if (!state.apiKey) return;
  state.source = new EventSource(`/dashboard/events?apiKey=${encodeURIComponent(state.apiKey)}`);
  state.source.addEventListener('ready', () => setStatus('Live dashboard connected.', 'live'));
  state.source.addEventListener('telemetry', (message) => {
    state.events = [JSON.parse(message.data), ...state.events].slice(0, 200);
    loadDashboard().catch(() => render());
  });
  state.source.addEventListener('error', (message) => {
    if (message.data) {
      state.errors = [JSON.parse(message.data), ...state.errors].slice(0, 100);
      loadDashboard().catch(() => render());
      return;
    }
    setStatus('Live stream disconnected. Reconnecting...', 'error');
  });
  state.source.addEventListener('client', () => {
    loadDashboard().catch(() => undefined);
  });
}

async function connect(apiKey) {
  state.apiKey = apiKey.trim();
  localStorage.setItem('orbit-dashboard-api-key', state.apiKey);
  setStatus('Connecting...');
  try {
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

if (state.apiKey) {
  connect(state.apiKey);
}
