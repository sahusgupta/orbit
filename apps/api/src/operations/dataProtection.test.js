import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataProtection from './dataProtection.js';

const { assertLogHashConfiguration, protectedIdentifier, redactDetails, redactStoredError, redactText } = dataProtection;
const trackedEnvironment = [
  'NODE_ENV',
  'ORBIT_DASHBOARD_SESSION_SECRET',
  'ORBIT_LOG_HASH_SECRET',
  'VERCEL'
];
const originalEnvironment = Object.fromEntries(trackedEnvironment.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of trackedEnvironment) {
    const originalValue = originalEnvironment[name];
    if (originalValue === undefined) delete process.env[name];
    else process.env[name] = originalValue;
  }
});

describe('protected log identifiers', () => {
  it('creates deterministic opaque references without retaining PII or the configured secret', () => {
    const secret = 'focused-test-log-hash-secret-with-at-least-32-characters';
    const identifier = 'Alex Player <alex.player@example.test> +1 (312) 555-0184';
    process.env.ORBIT_LOG_HASH_SECRET = secret;

    const reference = protectedIdentifier(identifier);
    const expected = crypto.createHmac('sha256', secret).update(identifier).digest('hex').slice(0, 16);

    expect(reference).toBe(expected);
    expect(protectedIdentifier(identifier)).toBe(reference);
    expect(reference).toMatch(/^[a-f0-9]{16}$/);
    expect(reference).not.toContain('Alex');
    expect(reference).not.toContain('example.test');
    expect(reference).not.toContain('555-0184');
    expect(reference).not.toContain(secret);
  });

  it('rejects an explicitly short secret outside production without exposing its value', () => {
    const shortSecret = 'sensitive-but-short';
    const configurationError = (() => {
      try {
        assertLogHashConfiguration({ NODE_ENV: 'development', ORBIT_LOG_HASH_SECRET: shortSecret });
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(configurationError).toBeInstanceOf(Error);
    expect(configurationError.message).toBe('ORBIT_LOG_HASH_SECRET must contain at least 32 characters.');
    expect(configurationError.message).not.toContain(shortSecret);

    process.env.NODE_ENV = 'test';
    process.env.ORBIT_LOG_HASH_SECRET = shortSecret;
    expect(() => protectedIdentifier('private-player-id')).toThrow('ORBIT_LOG_HASH_SECRET must contain at least 32 characters.');
  });

  it('requires the independent secret in production and hosted environments', () => {
    const dashboardSecret = 'dashboard-session-secret-that-is-long-enough-but-independent';
    const environments = [
      { NODE_ENV: 'production', ORBIT_DASHBOARD_SESSION_SECRET: dashboardSecret },
      { NODE_ENV: 'development', VERCEL: '1', ORBIT_DASHBOARD_SESSION_SECRET: dashboardSecret }
    ];

    for (const environment of environments) {
      const configurationError = (() => {
        try {
          assertLogHashConfiguration(environment);
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(configurationError).toBeInstanceOf(Error);
      expect(configurationError.message).toContain('ORBIT_LOG_HASH_SECRET');
      expect(configurationError.message).not.toContain(dashboardSecret);
    }
  });

  it.each([
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
  ])('rejects exact trimmed reuse of the %s credential', (secretName) => {
    const reusedSecret = 'one-shared-server-secret-that-is-long-enough-to-reject';
    const configurationError = (() => {
      try {
        assertLogHashConfiguration({
          NODE_ENV: 'production',
          ORBIT_LOG_HASH_SECRET: ` ${reusedSecret} `,
          [secretName]: reusedSecret
        });
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(configurationError).toBeInstanceOf(Error);
    expect(configurationError.message).toBe(
      'ORBIT_LOG_HASH_SECRET must be independent from every other server credential.'
    );
    expect(configurationError.message).not.toContain(reusedSecret);
  });

  it('rejects reuse of machine-client and Firebase private credentials', () => {
    const reusedSecret = 'one-shared-structured-secret-that-is-long-enough';
    for (const environment of [{
      NODE_ENV: 'production',
      ORBIT_LOG_HASH_SECRET: reusedSecret,
      ORBIT_MACHINE_CREDENTIALS_JSON: JSON.stringify([{ id: 'client-one', key: reusedSecret }])
    }, {
      NODE_ENV: 'production',
      ORBIT_LOG_HASH_SECRET: reusedSecret,
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({ private_key: reusedSecret })
    }, {
      NODE_ENV: 'production',
      ORBIT_LOG_HASH_SECRET: reusedSecret,
      FIREBASE_SERVICE_ACCOUNT_BASE64: Buffer.from(JSON.stringify({ private_key_id: reusedSecret })).toString('base64')
    }]) {
      expect(() => assertLogHashConfiguration(environment)).toThrow(
        'ORBIT_LOG_HASH_SECRET must be independent from every other server credential.'
      );
    }

    const credentialPath = 'C:\\local-test-only\\firebase-service-account.json';
    expect(() => assertLogHashConfiguration({
      NODE_ENV: 'production',
      ORBIT_LOG_HASH_SECRET: reusedSecret,
      GOOGLE_APPLICATION_CREDENTIALS: credentialPath
    }, {
      readFileSync: vi.fn((path, encoding) => {
        expect(path).toBe(credentialPath);
        expect(encoding).toBe('utf8');
        return JSON.stringify({ private_key: reusedSecret });
      })
    })).toThrow('ORBIT_LOG_HASH_SECRET must be independent from every other server credential.');
  });

  it('uses one ephemeral process secret when local configuration is absent', () => {
    const dashboardSecret = 'first-dashboard-secret-that-must-not-be-reused';
    process.env.NODE_ENV = 'development';
    process.env.ORBIT_DASHBOARD_SESSION_SECRET = dashboardSecret;
    delete process.env.ORBIT_LOG_HASH_SECRET;
    delete process.env.VERCEL;

    const identifier = 'private-local-player-id';
    const firstReference = protectedIdentifier(identifier);
    process.env.ORBIT_DASHBOARD_SESSION_SECRET = 'second-dashboard-secret-that-must-not-be-reused';
    const secondReference = protectedIdentifier(identifier);
    const dashboardDerivedReference = crypto.createHmac('sha256', dashboardSecret).update(identifier).digest('hex').slice(0, 16);

    expect(secondReference).toBe(firstReference);
    expect(firstReference).toMatch(/^[a-f0-9]{16}$/);
    expect(firstReference).not.toBe(dashboardDerivedReference);
  });

  it('removes bearer, JWT, provider, PEM, card, barcode, document, and payment material', () => {
    const fixtures = [
      'bearer-secret-value',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJwcml2YXRlIn0.signature12345',
      'sk_live_providerSecret123456',
      'whsec_webhookSecret123456',
      '4111 1111 1111 1111',
      'RAW-PDF417-PRIVATE',
      'DOC-PRIVATE-123',
      'PAYMENT-PRIVATE-123',
      'private-key-body'
    ];
    const text = [
      `Bearer ${fixtures[0]}`,
      fixtures[1],
      fixtures[2],
      fixtures[3],
      fixtures[4],
      `barcode=${fixtures[5]}`,
      `documentNumber=${fixtures[6]}`,
      `paymentToken=${fixtures[7]}`,
      `-----BEGIN PRIVATE KEY-----\n${fixtures[8]}\n-----END PRIVATE KEY-----`
    ].join('; ');
    const protectedDetails = redactDetails({
      safeText: text,
      nested: {
        rawBarcode: fixtures[5],
        documentNumber: fixtures[6],
        paymentCard: fixtures[4],
        error: text
      }
    });
    const serialized = JSON.stringify({ text: redactText(text, 2_000), protectedDetails });

    for (const fixture of fixtures) expect(serialized).not.toContain(fixture);
    expect(protectedDetails.nested).toEqual({
      rawBarcode: '[redacted]',
      documentNumber: '[redacted]',
      paymentCard: '[redacted]',
      error: '[redacted]'
    });
  });

  it('stores only a generic HMAC-referenced error in production', () => {
    const secret = 'production-log-hash-secret-with-at-least-32-characters';
    const raw = 'Bearer private-production-bearer-token-value';
    process.env.NODE_ENV = 'production';
    process.env.ORBIT_LOG_HASH_SECRET = secret;

    const stored = redactStoredError(raw, { label: 'Client error recorded' });

    expect(stored).toMatch(/^Client error recorded\. reference:[a-f0-9]{16}$/);
    expect(stored).not.toContain('private-production-bearer-token-value');
    expect(stored).not.toContain(secret);
  });
});
