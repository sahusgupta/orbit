import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');
const electronUpdateControllerSource = readFileSync(new URL('../../electron/updateController.cjs', import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

function extractFunctionSource(name: string) {
  const asyncStart = electronMainSource.indexOf(`async function ${name}(`);
  const start = asyncStart >= 0 ? asyncStart : electronMainSource.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Could not find ${name} in electron/main.cjs.`);
  const bodyStart = electronMainSource.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < electronMainSource.length; index += 1) {
    if (electronMainSource[index] === '{') depth += 1;
    if (electronMainSource[index] === '}') depth -= 1;
    if (depth === 0) return electronMainSource.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name} in electron/main.cjs.`);
}

function loadFunction<T>(name: string, globals: Record<string, unknown> = {}): T {
  const names = Object.keys(globals);
  const factory = Function(...names, `${extractFunctionSource(name)}; return ${name};`);
  return factory(...names.map((key) => globals[key])) as T;
}

type OrbitApiErrorDetails = (error: unknown) => {
  errorName: string;
  errorMessage: string;
  errorCode: unknown;
  cause: string;
};

type SendTwilioTextMessage = (
  config: { accountSid: string; from: string; username: string; password: string },
  message: { to: string; body: string }
) => Promise<unknown>;

type ValidateStatePayload = (state: unknown) => void;
type NormalizeTextMessageBatch = (payload: unknown) => Array<Record<string, string>>;
type SanitizeAccountKey = (value: unknown) => string;
type GetAccountKeyFromAccess = (access: unknown) => string;
type GetAccountKeyFromState = (state: unknown) => string;

type ElectronRuntimeUtils = {
  getAccountKeyFromAccess: GetAccountKeyFromAccess;
  getAccountKeyFromState: GetAccountKeyFromState;
  getRecordProperty: (value: unknown, key: string) => unknown;
  isRecord: (value: unknown) => boolean;
  normalizeTextMessageBatch: NormalizeTextMessageBatch;
  orbitApiErrorDetails: OrbitApiErrorDetails;
  sanitizeAccountKey: SanitizeAccountKey;
  validateStatePayload: ValidateStatePayload;
};

const runtimeUtils: ElectronRuntimeUtils = require('../../electron/runtimeUtils.cjs');

describe('Electron main compiler findings', () => {
  it('preserves Error and cause details including an authoritative nested error code', () => {
    const { orbitApiErrorDetails } = runtimeUtils;
    const cause = Object.assign(new Error('socket closed'), { code: 'ECONNRESET' });
    const error = new Error('request failed', { cause });

    expect(orbitApiErrorDetails(error)).toEqual({
      errorName: 'Error',
      errorMessage: 'request failed',
      errorCode: 'ECONNRESET',
      cause: 'socket closed'
    });
    expect(orbitApiErrorDetails('offline')).toEqual({
      errorName: 'Error',
      errorMessage: 'offline',
      errorCode: '',
      cause: ''
    });
  });

  it('uses a Twilio response message when present and the HTTP status fallback otherwise', async () => {
    const responseJson = vi.fn()
      .mockResolvedValueOnce({ message: 'Invalid destination' })
      .mockResolvedValueOnce(42);
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, json: responseJson });
    const sendTwilioTextMessage = loadFunction<SendTwilioTextMessage>('sendTwilioTextMessage', {
      Buffer,
      URLSearchParams,
      encodeURIComponent,
      fetch,
      getRecordProperty: runtimeUtils.getRecordProperty
    });
    const config = { accountSid: 'local-account', from: '+15550100', username: 'local-user', password: 'local-pass' };
    const message = { to: '+15550101', body: 'Local test' };

    await expect(sendTwilioTextMessage(config, message)).rejects.toThrow('Invalid destination');
    await expect(sendTwilioTextMessage(config, message)).rejects.toThrow('Twilio returned 400.');
  });

  it('registers before-quit telemetry on the native Electron updater that emits the event', () => {
    expect(electronUpdateControllerSource).toContain("nativeAutoUpdater.on('before-quit-for-update'");
    expect(electronUpdateControllerSource).not.toContain("autoUpdater.on('before-quit-for-update'");
  });
});

describe('Electron runtime boundary utilities', () => {
  it('validates the minimum persisted-state structure with exact failures', () => {
    const { validateStatePayload } = runtimeUtils;
    const validState = { games: [], sessions: [], playerSessions: [], settings: {} };

    expect(() => validateStatePayload(validState)).not.toThrow();
    expect(() => validateStatePayload(null)).toThrow('State payload must be an object.');
    expect(() => validateStatePayload({ ...validState, games: null })).toThrow('State payload is missing games.');
    expect(() => validateStatePayload({ ...validState, sessions: null })).toThrow('State payload is missing sessions.');
    expect(() => validateStatePayload({ ...validState, playerSessions: null })).toThrow('State payload is missing player sessions.');
    expect(() => validateStatePayload({ ...validState, settings: null })).toThrow('State payload is missing settings.');
  });

  it('normalizes, filters, orders, caps, and does not mutate outreach messages', () => {
    const { normalizeTextMessageBatch } = runtimeUtils;
    const messages = [
      { to: ' +15550101 ', body: ' First ', profileId: 7, playerName: 'Alex', gameId: 'nlh', reason: 'seat-opened' },
      { to: '', body: 'Missing destination' },
      { to: '+15550102', body: ' Second ' },
      ...Array.from({ length: 205 }, (_, index) => ({ to: `+15552${String(index).padStart(3, '0')}`, body: `Message ${index}` }))
    ];
    const payload = { messages };
    const before = structuredClone(payload);

    const normalized = normalizeTextMessageBatch(payload);

    expect(normalized).toHaveLength(200);
    expect(normalized.slice(0, 2)).toEqual([
      { to: '+15550101', body: 'First', profileId: '7', playerName: 'Alex', gameId: 'nlh', reason: 'seat-opened' },
      { to: '+15550102', body: 'Second', profileId: '', playerName: '', gameId: '', reason: '' }
    ]);
    expect(payload).toEqual(before);
  });

  it('preserves account-key precedence, normalization, fallback, and length limits', () => {
    const { getAccountKeyFromAccess, getAccountKeyFromState, sanitizeAccountKey } = runtimeUtils;

    expect(sanitizeAccountKey('  Club @ 123 !!! ')).toBe('club-123');
    expect(sanitizeAccountKey('A'.repeat(120))).toBe('a'.repeat(96));
    expect(getAccountKeyFromAccess({ licenseId: ' License Primary ', authorizationCode: 'ignored' })).toBe('license-primary');
    expect(getAccountKeyFromAccess({ authorizationCode: ' Auth Fallback ' })).toBe('auth-fallback');
    expect(getAccountKeyFromAccess(null)).toBe('');
    expect(getAccountKeyFromState({ settings: { pilotAccess: { licenseId: 'Pilot' }, clubAccount: { email: 'ignored@example.test' } } })).toBe('pilot');
    expect(getAccountKeyFromState({ settings: { clubAccount: { email: ' Room@Example.test ' } } })).toBe('room-example.test');
    expect(getAccountKeyFromState({ settings: {} })).toBe('unlicensed-local');
  });
});
