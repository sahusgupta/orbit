const { protectedIdentifier, redactDetails } = require('./dataProtection');

const allowedSeverities = new Set(['warning', 'critical']);

function configuredDestination() {
  const value = String(process.env.ORBIT_ALERT_WEBHOOK_URL || '').trim();
  if (!value) return null;
  let destination;
  try {
    destination = new URL(value);
  } catch {
    throw new Error('ORBIT_ALERT_WEBHOOK_URL must be a valid HTTPS URL.');
  }
  const allowedHosts = new Set(String(process.env.ORBIT_ALERT_WEBHOOK_ALLOWED_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
  if (destination.protocol !== 'https:' || destination.username || destination.password || !allowedHosts.has(destination.hostname.toLowerCase())) {
    throw new Error('Operational alert destination must be HTTPS, credential-free, and explicitly allowlisted.');
  }
  return destination.toString();
}

function buildOperationalAlert(event, severity, details = {}) {
  return {
    schemaVersion: 1,
    service: 'orbit-api',
    environment: String(process.env.NODE_ENV || 'development').slice(0, 40),
    event: String(event || 'unknown').slice(0, 100),
    severity: allowedSeverities.has(severity) ? severity : 'warning',
    occurredAt: new Date().toISOString(),
    details: redactDetails(details)
  };
}

async function sendOperationalAlert(event, severity, details = {}, options = {}) {
  const alert = buildOperationalAlert(event, severity, details);
  let destination;
  try {
    destination = options.destination === undefined ? configuredDestination() : options.destination;
  } catch (error) {
    console.error(`[orbit-alert-config] ${protectedIdentifier(error instanceof Error ? error.message : 'invalid')}`);
    return { delivered: false, reason: 'invalid-configuration', alert };
  }
  if (!destination) {
    console.warn(`[orbit-alert-undelivered] ${JSON.stringify(alert)}`);
    return { delivered: false, reason: 'not-configured', alert };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await (options.fetchImpl || fetch)(destination, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(alert),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`alert delivery returned ${response.status}`);
    return { delivered: true, alert };
  } catch (error) {
    console.error(`[orbit-alert-delivery] ${protectedIdentifier(error instanceof Error ? error.message : 'failed')}`);
    return { delivered: false, reason: 'delivery-failed', alert };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  buildOperationalAlert,
  configuredDestination,
  sendOperationalAlert
};
