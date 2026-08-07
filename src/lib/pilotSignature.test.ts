/**
 * @vitest-environment jsdom
 */
import { webcrypto } from 'node:crypto';
import { Session } from 'node:inspector/promises';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { RootOptions } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPayload } from './appCore';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type VerificationResult = { error?: string; ok?: boolean };

type ScriptLocation = {
  columnNumber?: number;
  lineNumber: number;
  scriptId: string;
};

const harness = vi.hoisted(() => ({
  appComponent: undefined as unknown,
  branding: undefined as unknown,
  publicKeyPem: '',
  root: undefined as { unmount: () => void } | undefined,
  stateSetter: undefined as unknown
}));

const isAppState = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray(Reflect.get(value, 'games')) &&
  Array.isArray(Reflect.get(value, 'profiles')) &&
  Array.isArray(Reflect.get(value, 'sessions')) &&
  typeof Reflect.get(value, 'settings') === 'object' &&
  Reflect.get(value, 'settings') !== null;

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
      const result = actual.useState(initialState);
      if (isAppState(result[0])) harness.stateSetter = result[1];
      return result;
    }
  };
});

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return {
    ...actual,
    createRoot(container: Element | DocumentFragment, options?: RootOptions) {
      const root = actual.createRoot(container, options);
      const render = root.render.bind(root);
      root.render = (children: ReactNode) => {
        const pending: unknown[] = [children];
        while (pending.length) {
          const child = pending.pop();
          if (typeof child !== 'object' || child === null) continue;
          if ('type' in child && typeof child.type === 'function') {
            harness.appComponent = child.type;
            break;
          }
          if ('props' in child && typeof child.props === 'object' && child.props !== null && 'children' in child.props) {
            const nested = child.props.children;
            pending.push(...(Array.isArray(nested) ? nested : [nested]));
          }
        }
        render(children);
      };
      harness.root = root;
      return root;
    }
  };
});

vi.mock('../../branding.config.json', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../branding.config.json')>();
  const branding = {
    ...actual,
    license: {
      ...actual.license,
      publicKeyPem: harness.publicKeyPem
    }
  };
  harness.branding = branding;
  return { default: branding };
});

vi.mock('./firebaseConfig', () => ({ rendererFirebaseSyncEnabled: false }));
vi.mock('./firebaseClubSync', () => ({
  loadClubStateFromFirebase: vi.fn(async () => null),
  saveClubStateToFirebase: vi.fn(async () => undefined),
  signInOrCreateFirebaseEmailAccount: vi.fn(async () => undefined),
  signOutOfFirebase: vi.fn(async () => undefined),
  subscribeToPlayerRequestUpdates: vi.fn(() => () => undefined),
  syncPlayerUpdatesToClubState: vi.fn(async <T,>(state: T) => state)
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const payload = {
  authorizationCode: 'TYPE-011-AUTH',
  expiresAt: '2099-12-31',
  issuedAt: '2026-08-07T12:00:00.000Z',
  issuedTo: 'TYPE-011 Fixture Club',
  licenseId: 'TYPE-011-LICENSE'
};

const toPem = (buffer: ArrayBuffer) => {
  const base64 = Buffer.from(buffer).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
};

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

const trimDerInteger = (bytes: Uint8Array) => {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
  const value = bytes.slice(start);
  if ((value[0] & 0x80) === 0) return value;
  const prefixed = new Uint8Array(value.length + 1);
  prefixed.set(value, 1);
  return prefixed;
};

const rawToDer = (raw: Uint8Array) => {
  if (raw.length !== 64) throw new Error('Expected a raw P-256 signature');
  const r = trimDerInteger(raw.slice(0, 32));
  const s = trimDerInteger(raw.slice(32));
  const der = new Uint8Array(6 + r.length + s.length);
  der.set([0x30, der.length - 2, 0x02, r.length], 0);
  der.set(r, 4);
  const sOffset = 4 + r.length;
  der.set([0x02, s.length], sOffset);
  der.set(s, sOffset + 2);
  return der;
};

const getBrandingLicense = () => {
  const license = Reflect.get(harness.branding as object, 'license');
  if (typeof license !== 'object' || license === null) throw new Error('Expected mocked license branding');
  return license;
};

const captureSignatureHelpers = async (session: Session) => {
  if (typeof harness.appComponent !== 'function') throw new Error('Expected to capture the App component');
  const stateSetter = harness.stateSetter;
  if (typeof stateSetter !== 'function') throw new Error('Expected to capture the application state setter');
  Reflect.set(globalThis, '__orbitType011App', harness.appComponent);
  const evaluated = await session.post('Runtime.evaluate', { expression: 'globalThis.__orbitType011App' });
  const appObjectId = evaluated.result.objectId;
  if (!appObjectId) throw new Error('Expected the App component to be inspectable');
  const properties = await session.post('Runtime.getProperties', { objectId: appObjectId, ownProperties: false });
  const location = properties.internalProperties?.find(
    (property) => property.name === '[[FunctionLocation]]'
  )?.value?.value;
  if (
    typeof location !== 'object' ||
    location === null ||
    !('scriptId' in location) ||
    typeof location.scriptId !== 'string' ||
    !('lineNumber' in location) ||
    typeof location.lineNumber !== 'number'
  ) {
    throw new Error('Expected the App component script location');
  }
  const sourceResult = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType011App.toString()',
    returnByValue: true
  });
  const source = sourceResult.result.value;
  if (typeof source !== 'string') throw new Error('Expected the App component source');
  const relativeLineNumber = source.split(/\r?\n/).findIndex((line) => line.includes('const updateSession'));
  if (relativeLineNumber < 0) throw new Error('Expected the signature-helper capture boundary');
  const breakpointLocation: ScriptLocation = {
    scriptId: location.scriptId,
    lineNumber: location.lineNumber + relativeLineNumber,
    columnNumber: 0
  };
  const breakpoint = await session.post('Debugger.setBreakpoint', { location: breakpointLocation });
  const completed = new Promise<void>((resolve, reject) => {
    session.once('Debugger.paused', (message) => {
      void (async () => {
        try {
          const callFrame = message.params.callFrames[0];
          if (!callFrame) throw new Error('Expected a paused App call frame');
          await session.post('Debugger.evaluateOnCallFrame', {
            callFrameId: callFrame.callFrameId,
            expression:
              'globalThis.__orbitType011Verify = verifyPilotSignature; ' +
              'globalThis.__orbitType011DerToRaw = derToRawP256Signature; true'
          });
          await session.post('Debugger.removeBreakpoint', { breakpointId: breakpoint.breakpointId });
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    });
  });
  await act(async () => {
    stateSetter((current: unknown) => {
      if (!isAppState(current)) throw new Error('Expected the current application state');
      return { ...current };
    });
  });
  await completed;
};

const invokeVerification = async (session: Session, candidatePayload: Record<string, unknown>, signature: Uint8Array) => {
  Reflect.set(globalThis, '__orbitType011Payload', candidatePayload);
  Reflect.set(globalThis, '__orbitType011Signature', toBase64(signature));
  const invocation = await session.post('Runtime.evaluate', {
    expression: 'globalThis.__orbitType011Verify(globalThis.__orbitType011Payload, globalThis.__orbitType011Signature)',
    awaitPromise: true,
    returnByValue: true
  });
  if (invocation.exceptionDetails) throw new Error(JSON.stringify(invocation.exceptionDetails));
  const result: unknown = invocation.result.value;
  if (typeof result !== 'object' || result === null) throw new Error('Expected a verification result');
  return result as VerificationResult;
};

const invokeDerToRaw = async (session: Session, signature: Uint8Array) => {
  Reflect.set(globalThis, '__orbitType011SignatureBytes', signature);
  const invocation = await session.post('Runtime.evaluate', {
    expression:
      'Array.from(new Uint8Array(globalThis.__orbitType011DerToRaw(globalThis.__orbitType011SignatureBytes)))',
    returnByValue: true
  });
  if (invocation.exceptionDetails) throw new Error(JSON.stringify(invocation.exceptionDetails));
  const result: unknown = invocation.result.value;
  if (!Array.isArray(result) || !result.every((value) => typeof value === 'number')) {
    throw new Error('Expected raw signature bytes');
  }
  return Uint8Array.from(result);
};

describe('pilot signature verification boundary', () => {
  const inspectorSession = new Session();
  let validRawSignature: Uint8Array;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T22:00:00.000Z'));
    vi.stubGlobal('crypto', webcrypto);
    const keyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    harness.publicKeyPem = toPem(await webcrypto.subtle.exportKey('spki', keyPair.publicKey));
    validRawSignature = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        keyPair.privateKey,
        new TextEncoder().encode(canonicalPayload(payload))
      )
    );
    document.body.innerHTML = '<div id="root"></div>';
    Reflect.set(window, 'tableManagerDesktop', {
      getBackendStatus: vi.fn(async () => ({ mode: 'local' })),
      loadState: vi.fn(async () => null),
      loadStateForAccount: vi.fn(async () => null),
      onPrepareForUpdate: vi.fn(() => () => undefined),
      openWindow: vi.fn(async () => undefined),
      preserveStateForUpdate: vi.fn(async () => ({ ok: true })),
      recordClientError: vi.fn(async () => ({ ok: true })),
      recordClientEvent: vi.fn(async () => ({ ok: true })),
      saveState: vi.fn(async () => ({ ok: true, path: 'fixture' })),
      sendTextMessages: vi.fn(async () => ({ ok: true })),
      submitAnalyticalReport: vi.fn(async () => ({ ok: true })),
      validatePilotAccess: vi.fn(async () => ({ ok: true, managed: false, active: true }))
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    inspectorSession.connect();
    await inspectorSession.post('Debugger.enable');
    await act(async () => {
      await import('../main');
    });
    await captureSignatureHelpers(inspectorSession);
  });

  beforeEach(() => {
    Reflect.set(getBrandingLicense(), 'publicKeyPem', harness.publicKeyPem);
  });

  afterAll(() => {
    inspectorSession.disconnect();
    for (const key of [
      '__orbitType011App',
      '__orbitType011Verify',
      '__orbitType011DerToRaw',
      '__orbitType011Payload',
      '__orbitType011Signature',
      '__orbitType011SignatureBytes'
    ]) {
      Reflect.deleteProperty(globalThis, key);
    }
    Reflect.deleteProperty(window, 'tableManagerDesktop');
    act(() => harness.root?.unmount());
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('accepts the valid raw signature and converts equivalent DER bytes exactly', async () => {
    const derSignature = rawToDer(validRawSignature);

    await expect(invokeVerification(inspectorSession, payload, validRawSignature)).resolves.toEqual({ ok: true });
    await expect(invokeVerification(inspectorSession, payload, derSignature)).resolves.toEqual({ ok: true });
    await expect(invokeDerToRaw(inspectorSession, derSignature)).resolves.toEqual(validRawSignature);
  });

  it('rejects a signature produced by a different P-256 key', async () => {
    const wrongKeyPair = await webcrypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );
    const wrongSignature = new Uint8Array(
      await webcrypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        wrongKeyPair.privateKey,
        new TextEncoder().encode(canonicalPayload(payload))
      )
    );

    await expect(invokeVerification(inspectorSession, payload, wrongSignature)).resolves.toEqual({
      ok: false,
      error: 'License signature is invalid.'
    });
  });

  it('rejects a modified payload with an otherwise valid signature', async () => {
    await expect(
      invokeVerification(inspectorSession, { ...payload, issuedTo: 'Modified Fixture Club' }, validRawSignature)
    ).resolves.toEqual({ ok: false, error: 'License signature is invalid.' });
  });

  it('rejects malformed DER and wrong-length raw signatures', async () => {
    await expect(
      invokeVerification(inspectorSession, payload, Uint8Array.from([0x30, 0x06, 0x02, 0x01, 0x01]))
    ).resolves.toEqual({ ok: false, error: 'Unable to verify license signature.' });
    await expect(invokeVerification(inspectorSession, payload, new Uint8Array(63))).resolves.toEqual({
      ok: false,
      error: 'Unable to verify license signature.'
    });
  });

  it('rejects a public key whose algorithm is unsupported by the P-256 verifier', async () => {
    const unsupportedKeyPair = await webcrypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: Uint8Array.from([1, 0, 1])
      },
      true,
      ['sign', 'verify']
    );
    Reflect.set(
      getBrandingLicense(),
      'publicKeyPem',
      toPem(await webcrypto.subtle.exportKey('spki', unsupportedKeyPair.publicKey))
    );

    await expect(invokeVerification(inspectorSession, payload, validRawSignature)).resolves.toEqual({
      ok: false,
      error: 'Unable to verify license signature.'
    });
  });
});
