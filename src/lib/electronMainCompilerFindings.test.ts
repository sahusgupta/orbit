import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const electronMainSource = readFileSync(new URL('../../electron/main.cjs', import.meta.url), 'utf8');

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

function loadGetRecordProperty() {
  const isRecord = loadFunction<(value: unknown) => boolean>('isRecord');
  return loadFunction<(value: unknown, key: string) => unknown>('getRecordProperty', { isRecord });
}

describe('Electron main compiler findings', () => {
  it('preserves Error and cause details including an authoritative nested error code', () => {
    const orbitApiErrorDetails = loadFunction<OrbitApiErrorDetails>('orbitApiErrorDetails', {
      getRecordProperty: loadGetRecordProperty()
    });
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
      getRecordProperty: loadGetRecordProperty()
    });
    const config = { accountSid: 'local-account', from: '+15550100', username: 'local-user', password: 'local-pass' };
    const message = { to: '+15550101', body: 'Local test' };

    await expect(sendTwilioTextMessage(config, message)).rejects.toThrow('Invalid destination');
    await expect(sendTwilioTextMessage(config, message)).rejects.toThrow('Twilio returned 400.');
  });

  it('registers before-quit telemetry on the native Electron updater that emits the event', () => {
    const startAutoUpdates = extractFunctionSource('startAutoUpdates');

    expect(startAutoUpdates).toContain("nativeAutoUpdater.on('before-quit-for-update'");
    expect(startAutoUpdates).not.toContain("autoUpdater.on('before-quit-for-update'");
  });
});
