import { afterEach, describe, expect, it, vi } from 'vitest';
import alerts from './operationalAlerts.js';

const { buildOperationalAlert, configuredDestination, sendOperationalAlert } = alerts;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('operational alerts', () => {
  it('redacts details and does not require an external destination in development', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await sendOperationalAlert('api-error', 'critical', {
      email: 'person@example.com',
      requestId: 'request-1'
    }, { destination: null });
    expect(result).toMatchObject({ delivered: false, reason: 'not-configured' });
    expect(result.alert.details).not.toMatchObject({ email: 'person@example.com' });
    expect(JSON.stringify(result.alert)).not.toContain('person@example.com');
  });

  it('requires an allowlisted credential-free HTTPS destination', () => {
    vi.stubEnv('ORBIT_ALERT_WEBHOOK_URL', 'https://alerts.example.test/orbit');
    vi.stubEnv('ORBIT_ALERT_WEBHOOK_ALLOWED_HOSTS', 'alerts.example.test');
    expect(configuredDestination()).toBe('https://alerts.example.test/orbit');

    vi.stubEnv('ORBIT_ALERT_WEBHOOK_URL', 'http://alerts.example.test/orbit');
    expect(configuredDestination).toThrow('must be HTTPS');
  });

  it('delivers only the structured redacted event to the configured adapter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    const result = await sendOperationalAlert('authentication-abuse', 'warning', {
      identityRef: 'hashed-identity',
      credential: 'must-not-leak'
    }, {
      destination: 'https://alerts.example.test/orbit',
      fetchImpl
    });
    expect(result.delivered).toBe(true);
    const sent = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(sent).toMatchObject({
      schemaVersion: 1,
      service: 'orbit-api',
      event: 'authentication-abuse',
      severity: 'warning',
      details: { identityRef: 'hashed-identity', credential: '[redacted]' }
    });
    expect(JSON.stringify(sent)).not.toContain('must-not-leak');
  });
});
