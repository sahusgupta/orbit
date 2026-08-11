import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

const firebasePublisherSource = readFileSync(
  new URL('../../apps/api/src/firebasePublisher.js', import.meta.url),
  'utf8'
);
const licenseServiceSource = readFileSync(
  new URL('../../apps/api/src/licenseService.js', import.meta.url),
  'utf8'
);

function extractFunctionSource(source: string, file: string, name: string) {
  const asyncStart = source.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in ${file}.`);
  const parametersStart = source.indexOf('(', start);
  let parameterDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === '(') parameterDepth += 1;
    if (source[index] === ')') parameterDepth -= 1;
    if (parameterDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf('{', parametersEnd);
  let bodyDepth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') bodyDepth += 1;
    if (source[index] === '}') bodyDepth -= 1;
    if (bodyDepth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in ${file}.`);
}

function loadFunction<T>(source: string, file: string, name: string, globals: Record<string, unknown> = {}) {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(source, file, name)}; return ${name};`);
  return factory(...names.map((key) => globals[key])) as T;
}

type GetServiceAccountToken = (serviceAccount: { client_email: string; private_key: string }) => Promise<string>;
type DeleteLegacyPlayerDocuments = (
  projectId: string,
  token: string,
  clubId: string,
  playerDocs: Array<{ id: string; sourceProfileId?: string }>
) => Promise<number>;

type LicenseRecord = {
  id: string;
  accountKey: string;
  expiresAt: string;
  lastAuthenticatedAt?: string;
  status: string;
};
type AuthenticatePilotLicense = (authorizationCode: string) => Promise<{
  managed: boolean;
  active: boolean;
  license: LicenseRecord | null;
}>;
type RenewPilotLicense = (
  id: string,
  options?: { expiresAt?: string; extendDays?: number }
) => Promise<LicenseRecord>;

const getFirebaseRecordProperty = loadFunction<(value: unknown, key: string) => unknown>(
  firebasePublisherSource,
  'apps/api/src/firebasePublisher.js',
  'getRecordProperty'
);

afterEach(() => {
  vi.useRealTimers();
});

describe('API Firebase REST compiler boundaries', () => {
  it('projects the OAuth access token and preserves the JWT request contract', async () => {
    const signer = {
      update: vi.fn(),
      sign: vi.fn(() => 'local-signature==')
    };
    signer.update.mockReturnValue(signer);
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ access_token: 'local-access-token', token_type: 'Bearer' }),
      text: vi.fn()
    });
    const getServiceAccountToken = loadFunction<GetServiceAccountToken>(
      firebasePublisherSource,
      'apps/api/src/firebasePublisher.js',
      'getServiceAccountToken',
      {
        base64Url: (value: string) => Buffer.from(value).toString('base64url'),
        crypto: { createSign: vi.fn(() => signer) },
        fetch,
        getRecordProperty: getFirebaseRecordProperty,
        URLSearchParams
      }
    );

    await expect(getServiceAccountToken({
      client_email: 'local-service@example.test',
      private_key: 'local-private-key'
    })).resolves.toBe('local-access-token');

    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: URLSearchParams }];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'content-type': 'application/x-www-form-urlencoded' });
    expect(options.body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(options.body.get('assertion')).toMatch(/\.local-signature$/);
  });

  it('deletes only stale player document IDs and treats a missing document list as empty', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          documents: [
            {
              name: 'projects/local/databases/(default)/documents/clubs/club-a/players/legacy-player',
              fields: { sourceProfileId: { stringValue: 'profile-a' } }
            },
            {
              name: 'projects/local/databases/(default)/documents/clubs/club-a/players/player-b',
              fields: { sourceProfileId: { stringValue: 'profile-b' } }
            },
            {
              name: 'projects/local/databases/(default)/documents/clubs/club-a/players/unrelated',
              fields: { sourceProfileId: { stringValue: 'profile-z' } }
            }
          ]
        }),
        text: vi.fn()
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: vi.fn().mockResolvedValue({}), text: vi.fn() });
    const batchWriteDocuments = vi.fn().mockResolvedValue(1);
    const deleteLegacyPlayerDocuments = loadFunction<DeleteLegacyPlayerDocuments>(
      firebasePublisherSource,
      'apps/api/src/firebasePublisher.js',
      'deleteLegacyPlayerDocuments',
      {
        encodeURIComponent,
        batchWriteDocuments,
        fetch,
        getRecordProperty: getFirebaseRecordProperty,
        restBase: (projectId: string) => `https://firestore.googleapis.test/v1/projects/${projectId}/documents`,
        URL
      }
    );
    const playerDocs = [
      { id: 'player-a', sourceProfileId: 'profile-a' },
      { id: 'player-b', sourceProfileId: 'profile-b' }
    ];
    const before = structuredClone(playerDocs);

    await expect(deleteLegacyPlayerDocuments('local-project', 'local-token', 'club-a', playerDocs)).resolves.toBe(1);
    await expect(deleteLegacyPlayerDocuments('local-project', 'local-token', 'club-a', playerDocs)).resolves.toBe(0);

    expect(fetch.mock.calls).toEqual([
      [
        'https://firestore.googleapis.test/v1/projects/local-project/documents/clubs/club-a/players?pageSize=500',
        { headers: { authorization: 'Bearer local-token' } }
      ],
      [
        'https://firestore.googleapis.test/v1/projects/local-project/documents/clubs/club-a/players?pageSize=500',
        { headers: { authorization: 'Bearer local-token' } }
      ]
    ]);
    expect(batchWriteDocuments).toHaveBeenNthCalledWith(1, 'local-project', 'local-token', [
      { delete: 'projects/local/databases/(default)/documents/clubs/club-a/players/legacy-player' }
    ]);
    expect(batchWriteDocuments).toHaveBeenNthCalledWith(2, 'local-project', 'local-token', []);
    expect(playerDocs).toEqual(before);
  });

  it('rejects malformed successful REST payloads before using credentials or document paths', async () => {
    const signer = {
      update: vi.fn(),
      sign: vi.fn(() => 'local-signature==')
    };
    signer.update.mockReturnValue(signer);
    const tokenFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ token_type: 'Bearer' }),
      text: vi.fn()
    });
    const getServiceAccountToken = loadFunction<GetServiceAccountToken>(
      firebasePublisherSource,
      'apps/api/src/firebasePublisher.js',
      'getServiceAccountToken',
      {
        base64Url: (value: string) => Buffer.from(value).toString('base64url'),
        crypto: { createSign: vi.fn(() => signer) },
        fetch: tokenFetch,
        getRecordProperty: getFirebaseRecordProperty,
        URLSearchParams
      }
    );
    await expect(getServiceAccountToken({
      client_email: 'local-service@example.test',
      private_key: 'local-private-key'
    })).rejects.toThrow('Firebase token response did not include an access token.');

    const listingFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ documents: 'not-a-document-list' }),
      text: vi.fn()
    });
    const deleteLegacyPlayerDocuments = loadFunction<DeleteLegacyPlayerDocuments>(
      firebasePublisherSource,
      'apps/api/src/firebasePublisher.js',
      'deleteLegacyPlayerDocuments',
      {
        encodeURIComponent,
        fetch: listingFetch,
        getRecordProperty: getFirebaseRecordProperty,
        restBase: (projectId: string) => `https://firestore.googleapis.test/v1/projects/${projectId}/documents`
      }
    );
    await expect(deleteLegacyPlayerDocuments(
      'local-project',
      'local-token',
      'club-a',
      [{ id: 'player-a', sourceProfileId: 'profile-a' }]
    )).rejects.toThrow('Firestore player listing returned an invalid document list for club-a.');
  });
});

describe('API license compiler boundaries', () => {
  it('records and returns the exact successful authentication timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-02-03T04:05:06.000Z'));
    const record: LicenseRecord = {
      id: 'license-doc',
      accountKey: 'club-a',
      expiresAt: '2028-01-01T00:00:00.000Z',
      status: 'active'
    };
    const set = vi.fn().mockResolvedValue(undefined);
    const authenticatePilotLicense = loadFunction<AuthenticatePilotLicense>(
      licenseServiceSource,
      'apps/api/src/licenseService.js',
      'authenticatePilotLicense',
      {
        Date,
        findLicenseByAuthorizationCode: vi.fn().mockResolvedValue(record),
        getLicenseCollection: () => ({ doc: (id: string) => ({ id, set }) }),
        isLicenseActive: () => true,
        publicLicense: (value: LicenseRecord) => ({ ...value })
      }
    );

    await expect(authenticatePilotLicense('TT-PILOT-LOCAL')).resolves.toEqual({
      managed: true,
      active: true,
      license: { ...record, lastAuthenticatedAt: '2027-02-03T04:05:06.000Z' }
    });
    expect(set).toHaveBeenCalledWith(
      { lastAuthenticatedAt: '2027-02-03T04:05:06.000Z' },
      { merge: true }
    );
  });

  it('renews from an authoritative stored expiration while preserving the record', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'));
    const stored: LicenseRecord = {
      id: 'license-doc',
      accountKey: 'club-a',
      expiresAt: '2027-01-10T00:00:00.000Z',
      status: 'expired'
    };
    const set = vi.fn().mockResolvedValue(undefined);
    const snapshot = {
      exists: true,
      id: stored.id,
      data: () => ({
        accountKey: stored.accountKey,
        expiresAt: stored.expiresAt,
        status: stored.status
      }),
      get: (field: keyof LicenseRecord) => stored[field]
    };
    const renewPilotLicense = loadFunction<RenewPilotLicense>(
      licenseServiceSource,
      'apps/api/src/licenseService.js',
      'renewPilotLicense',
      {
        Date,
        getLicenseCollection: () => ({ doc: (id: string) => ({ id, get: async () => snapshot, set }) }),
        normalizeExpiration: (value: string) => new Date(value).toISOString(),
        publicLicense: (value: LicenseRecord) => ({ ...value })
      }
    );

    await expect(renewPilotLicense('license-doc', { extendDays: 5 })).resolves.toMatchObject({
      id: 'license-doc',
      accountKey: 'club-a',
      expiresAt: '2027-01-15T00:00:00.000Z',
      status: 'active',
      updatedAt: '2027-01-01T00:00:00.000Z'
    });
    expect(set).toHaveBeenCalledWith({
      expiresAt: '2027-01-15T00:00:00.000Z',
      status: 'active',
      updatedAt: '2027-01-01T00:00:00.000Z'
    }, { merge: true });
    expect(stored).toEqual({
      id: 'license-doc',
      accountKey: 'club-a',
      expiresAt: '2027-01-10T00:00:00.000Z',
      status: 'expired'
    });
  });
});

describe('API Stripe CommonJS compiler boundary', () => {
  it('exposes identical constructable CommonJS, named, and default exports without making a request', () => {
    type StripeConstructor = {
      new (secretKey: string): { checkout: { sessions: { create: unknown } } };
      default: StripeConstructor;
      Stripe: StripeConstructor;
    };
    const requireFromApi = createRequire(new URL('../../apps/api/package.json', import.meta.url));
    const Stripe = requireFromApi('stripe') as StripeConstructor;

    expect(Stripe.default).toBe(Stripe);
    expect(Stripe.Stripe).toBe(Stripe);
    const client = new Stripe('sk_test_local_only');
    expect(client.checkout.sessions.create).toBeTypeOf('function');
  });
});
