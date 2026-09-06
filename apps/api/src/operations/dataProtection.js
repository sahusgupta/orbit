const crypto = require('crypto');
const fs = require('fs');

const restrictedKeyPattern = /(authorization|barcode|bearer|birthday|body|card|credential|document|email|error|jwt|key|license|mutationid|name|password|payment|pdf417|phone|pin|player|preview|profile|raw|requestid|response|secret|stack|state|token|user|webhook)/i;
const minimumLogHashSecretLength = 32;
let ephemeralLogHashSecret;
const independentServerSecretNames = Object.freeze([
  'ORBIT_CLIENT_API_KEY',
  'ORBIT_OWNER_API_KEY',
  'ORBIT_DASHBOARD_PASSWORD',
  'ORBIT_DASHBOARD_SESSION_SECRET',
  'ORBIT_SELF_CHECK_IN_SECRET',
  'ORBIT_MEMBERSHIP_QR_SECRET',
  'ORBIT_PHONE_CHALLENGE_SECRET',
  'ORBIT_DELETION_PSEUDONYM_SECRET',
  'ORBIT_ALERT_WEBHOOK_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'REVENUECAT_WEBHOOK_AUTH_TOKEN',
  'TWILIO_AUTH_TOKEN'
]);

function isHostedOrProduction(environment) {
  return environment.NODE_ENV === 'production' || Boolean(environment.VERCEL);
}

function configuredServerSecrets(environment, dependencies = {}) {
  const configured = independentServerSecretNames
    .map((name) => String(environment[name] ?? '').trim())
    .filter(Boolean);
  try {
    const credentials = JSON.parse(String(environment.ORBIT_MACHINE_CREDENTIALS_JSON || '[]'));
    if (Array.isArray(credentials)) {
      configured.push(...credentials.map((credential) => String(credential?.key || '').trim()).filter(Boolean));
    }
  } catch {
    // Machine-credential validation owns malformed JSON; it cannot equal a raw log HMAC key.
  }
  for (const encoded of [
    String(environment.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim(),
    (() => {
      try {
        return Buffer.from(String(environment.FIREBASE_SERVICE_ACCOUNT_BASE64 || ''), 'base64').toString('utf8');
      } catch {
        return '';
      }
    })(),
    (() => {
      const credentialPath = String(environment.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
      if (!credentialPath) return '';
      try {
        return String((dependencies.readFileSync || fs.readFileSync)(credentialPath, 'utf8'));
      } catch {
        return '';
      }
    })()
  ]) {
    if (!encoded) continue;
    try {
      const serviceAccount = JSON.parse(encoded);
      configured.push(
        String(serviceAccount?.private_key || '').trim(),
        String(serviceAccount?.private_key_id || '').trim()
      );
    } catch {
      // Firebase credential parsing reports malformed configuration at its own startup boundary.
    }
  }
  return configured.filter(Boolean);
}

function resolveLogHashSecret(environment = process.env, dependencies = {}) {
  const hasConfiguredSecret = Object.prototype.hasOwnProperty.call(environment, 'ORBIT_LOG_HASH_SECRET');
  if (hasConfiguredSecret) {
    const configuredSecret = String(environment.ORBIT_LOG_HASH_SECRET ?? '').trim();
    if (configuredSecret.length < minimumLogHashSecretLength) {
      throw new Error('ORBIT_LOG_HASH_SECRET must contain at least 32 characters.');
    }
    if (configuredServerSecrets(environment, dependencies).includes(configuredSecret)) {
      throw new Error('ORBIT_LOG_HASH_SECRET must be independent from every other server credential.');
    }
    return configuredSecret;
  }

  if (isHostedOrProduction(environment)) {
    throw new Error('ORBIT_LOG_HASH_SECRET must be configured with at least 32 characters in hosted or production environments.');
  }

  ephemeralLogHashSecret = ephemeralLogHashSecret || crypto.randomBytes(minimumLogHashSecretLength);
  return ephemeralLogHashSecret;
}

function assertLogHashConfiguration(environment = process.env, dependencies = {}) {
  resolveLogHashSecret(environment, dependencies);
}

function protectedIdentifier(value) {
  const secret = resolveLogHashSecret();
  if (!value) return '';
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 16);
}

function redactText(value, maximum = 500) {
  return String(value || '')
    .replace(/-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----/gi, '[private-key]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [credential]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[jwt]')
    .replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/gi, '[provider-key]')
    .replace(/\bwhsec_[A-Za-z0-9_-]{8,}\b/gi, '[webhook-secret]')
    .replace(/\b(?:access[_-]?token|auth[_-]?token|refresh[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, '[credential]')
    .replace(/\b(?:barcode|pdf417|raw(?:data|payload)?|document(?:number|id)?|license(?:number|id)?|payment(?:method|token)?|card(?:number)?)\s*[:=]\s*[^\r\n,;]+/gi, '[restricted-data]')
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[card]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/TT-PILOT-[A-F0-9]{24}/gi, '[pilot-code]')
    .slice(0, maximum);
}

function redactStoredError(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const maximum = Math.min(Math.max(Number(options.maximum || 500), 40), 2_000);
  if (isHostedOrProduction(options.environment || process.env)) {
    const label = String(options.label || 'Operational error recorded').replace(/[^A-Za-z0-9 -]/g, '').slice(0, 80)
      || 'Operational error recorded';
    return `${label}. reference:${protectedIdentifier(raw)}`.slice(0, maximum);
  }
  return redactText(raw, maximum).trim();
}

function redactDetails(value, depth = 0) {
  if (depth > 3 || value === null || value === undefined) return null;
  if (typeof value === 'string') return redactText(value, 300);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactDetails(item, depth + 1));
  if (typeof value !== 'object') return null;
  return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
    key,
    restrictedKeyPattern.test(key) ? '[redacted]' : redactDetails(item, depth + 1)
  ]));
}

module.exports = {
  assertLogHashConfiguration,
  isHostedOrProduction,
  protectedIdentifier,
  redactDetails,
  redactStoredError,
  redactText
};
