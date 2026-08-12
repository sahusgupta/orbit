const crypto = require('crypto');

const restrictedKeyPattern = /(authorization|birthday|body|credential|email|key|name|password|phone|pin|player|preview|profile|response|secret|stack|state|token|user)/i;

function protectedIdentifier(value) {
  if (!value) return '';
  const secret = process.env.ORBIT_LOG_HASH_SECRET || process.env.ORBIT_DASHBOARD_SESSION_SECRET || 'orbit-local-redaction';
  return crypto.createHmac('sha256', secret).update(String(value)).digest('hex').slice(0, 16);
}

function redactText(value, maximum = 500) {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[phone]')
    .replace(/TT-PILOT-[A-F0-9]{24}/gi, '[pilot-code]')
    .slice(0, maximum);
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
  protectedIdentifier,
  redactDetails,
  redactText
};
