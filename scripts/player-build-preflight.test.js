// @vitest-environment node
import { PassThrough, Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessUsage, createPreflight, parseArguments, readLocalGitState, readUsageInput, runCli } from './player-build-preflight.mjs';

const sha = 'a1'.repeat(20);
const observedAt = '2026-10-31T21:59:00.000Z';
const now = '2026-10-31T22:00:00.000Z';
const account = 'saussy';
const marker = 'synthetic-sensitive-value-do-not-echo';

function usage() {
  return {
    account: { name: account, plan: 'Free', billingPeriod: {
      start: '2026-10-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z'
    } },
    builds: { plan: { used: 20, limit: 30 }, ios: { plan: { used: 10, limit: 15 } } }
  };
}

function localChecks() {
  return { expectedSha: sha, actualSha: sha, clean: true, onMain: false,
    toolVersion: '23.2.0', expectedToolVersion: '23.2.0', profileValid: true, expectedAccount: account };
}

function input() {
  return { ...localChecks(), usage: usage(), observedAt, now };
}

function cliOptions() {
  return { inspect: vi.fn(async () => localChecks()), writeOut: vi.fn(), writeError: vi.fn(), now: () => now };
}

function expectReleased(stream) {
  for (const event of ['data', 'end', 'error', 'close']) expect(stream.listenerCount(event)).toBe(0);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('offline EAS usage assessment', () => {
  it('reports absent usage as unobserved without inferring capacity', () => {
    for (const absent of [undefined, null]) {
      expect(assessUsage(absent, observedAt, now, account)).toEqual({
        status: 'unobserved', total: null, ios: null, observedAt: null, cycleEnd: null
      });
    }
  });

  it('selects only validated free-plan counts and canonical UTC dates', () => {
    const source = usage();
    source.account.billingPeriod.end = '2026-11-01T00:00:00Z';
    expect(assessUsage(source, '2026-10-31T21:59:00Z', now, account)).toEqual({
      status: 'available-as-observed', total: { used: 20, limit: 30, remaining: 10 },
      ios: { used: 10, limit: 15, remaining: 5 }, observedAt, cycleEnd: '2026-11-01T00:00:00.000Z'
    });
  });

  it.each([
    ['total', 'used', -1], ['total', 'used', 1.5], ['total', 'used', '20'],
    ['total', 'used', NaN], ['total', 'limit', 0], ['total', 'limit', Infinity],
    ['ios', 'used', null], ['ios', 'used', Number.MAX_SAFE_INTEGER + 1],
    ['ios', 'limit', -1], ['ios', 'limit', 1.5], ['ios', 'limit', '15'], ['ios', 'limit', undefined]
  ])('rejects malformed %s.%s allowance %s', (platform, field, value) => {
    const source = usage();
    const plan = platform === 'total' ? source.builds.plan : source.builds.ios.plan;
    plan[field] = value;
    expect(assessUsage(source, observedAt, now, account)).toEqual({
      status: 'invalid', total: null, ios: null, observedAt: null, cycleEnd: null
    });
  });

  it('accepts zero usage while rejecting inconsistent iOS totals', () => {
    const source = usage();
    source.builds.plan.used = 0;
    source.builds.ios.plan.used = 0;
    expect(assessUsage(source, observedAt, now, account).status).toBe('available-as-observed');
    source.builds.ios.plan.used = 1;
    expect(assessUsage(source, observedAt, now, account).status).toBe('invalid');
    source.builds.ios.plan.used = 0;
    source.builds.ios.plan.limit = 31;
    expect(assessUsage(source, observedAt, now, account).status).toBe('invalid');
  });

  it.each(['string', 'array', 'missing-account', 'missing-ios'])('rejects incomplete usage envelope %s', (kind) => {
    const source = kind === 'string' ? marker : kind === 'array' ? [] : usage();
    if (kind === 'missing-account') delete source.account;
    if (kind === 'missing-ios') source.builds.ios = null;
    const result = assessUsage(source, observedAt, now, account);
    expect(result.status).toBe('invalid');
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it('suppresses another account and unsupported paid-plan accounting', () => {
    const source = usage();
    source.account.name = marker;
    expect(assessUsage(source, observedAt, now, account).status).toBe('account-mismatch');
    expect(JSON.stringify(assessUsage(source, observedAt, now, account))).not.toContain(marker);
    source.account.name = account;
    source.account.plan = 'Starter';
    expect(assessUsage(source, observedAt, now, account)).toMatchObject({
      status: 'unsupported-plan', total: null, ios: null
    });
  });

  it.each([
    [30, 10, 0, 5], [20, 15, 10, 0], [31, 16, 0, 0]
  ])('requires capacity in both allowances when total=%s and iOS=%s', (totalUsed, iosUsed, totalRemaining, iosRemaining) => {
    const source = usage();
    source.builds.plan.used = totalUsed;
    source.builds.ios.plan.used = iosUsed;
    expect(assessUsage(source, observedAt, now, account)).toMatchObject({ status: 'exhausted',
      total: { remaining: totalRemaining }, ios: { remaining: iosRemaining } });
  });

  it('accepts an observation exactly 15 minutes old but rejects an additional millisecond', () => {
    expect(assessUsage(usage(), '2026-10-31T21:45:00.000Z', now, account).status).toBe('available-as-observed');
    expect(assessUsage(usage(), '2026-10-31T21:44:59.999Z', now, account).status).toBe('stale');
    expect(assessUsage(usage(), now, now, account).status).toBe('available-as-observed');
    expect(assessUsage(usage(), '2026-10-31T22:00:00.001Z', now, account).status).toBe('invalid');
  });

  it('does not infer a reset at or beyond the supplied cycle end', () => {
    const source = usage();
    const end = source.account.billingPeriod.end;
    expect(assessUsage(source, '2026-10-31T23:59:00.000Z', end, account).status).toBe('stale');
    expect(assessUsage(source, end, end, account).status).toBe('stale');
    expect(assessUsage(source, '2026-11-01T00:01:00.000Z', '2026-11-01T00:02:00.000Z', account).status).toBe('stale');
    expect(assessUsage(source, '2026-09-30T23:59:00.000Z', '2026-10-01T00:00:00.000Z', account).status).toBe('stale');
  });

  it.each(['2026-02-30T22:00:00Z', '2026-10-31', '2026-10-31T22:00:00+00:00', '2026-10-31T22:00:00.1Z'])('rejects noncanonical or invalid UTC time %s', (value) => {
    expect(assessUsage(usage(), value, now, account).status).toBe('invalid');
    expect(assessUsage(usage(), observedAt, value, account).status).toBe('invalid');
  });

  it('rejects invalid or reversed billing periods', () => {
    const source = usage();
    source.account.billingPeriod.start = source.account.billingPeriod.end;
    expect(assessUsage(source, observedAt, now, account).status).toBe('invalid');
    source.account.billingPeriod.start = '2026-12-01T00:00:00.000Z';
    expect(assessUsage(source, observedAt, now, account).status).toBe('invalid');
    source.account.billingPeriod = null;
    expect(assessUsage(source, observedAt, now, account).status).toBe('invalid');
  });

  it('drops unknown sensitive fields and inert __proto__ input without changing the input or global prototype', () => {
    const source = JSON.parse(JSON.stringify({ ...usage(), password: marker, updates: { token: marker },
      ['__proto__']: { preflightPolluted: marker } }));
    const before = JSON.stringify(source);
    const result = assessUsage(source, observedAt, now, account);
    expect(result.status).toBe('available-as-observed');
    expect(JSON.stringify(result)).not.toMatch(/password|token|preflightPolluted|__proto__/);
    expect(JSON.stringify(result)).not.toContain(marker);
    expect(JSON.stringify(source)).toBe(before);
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'preflightPolluted')).toBeUndefined();
  });
});

describe('offline local preflight gates', () => {
  it('accepts case-insensitive matching source but never claims a build or signing readiness', () => {
    const result = createPreflight({ ...input(), actualSha: sha.toUpperCase() });
    expect(result).toMatchObject({ mode: 'offline', localChecksPass: true, exitCode: 0,
      buildStarted: false, submissionStarted: false, readyToBuild: false,
      usageObservationSource: 'supplied-json-not-authenticated', blockers: [] });
    expect(result.capacity.status).toBe('available-as-observed');
    expect(result.externalGatesNotVerified).toContain('apple-signing-and-credentials');
    expect(result.externalGatesNotVerified).toContain('explicit-build-confirmation');
  });

  it.each([
    ['actualSha', 'b2'.repeat(20), 'source-mismatch'],
    ['expectedSha', marker, 'source-mismatch'],
    ['clean', 'true', 'uncommitted-source'],
    ['onMain', true, 'branch-not-allowed'],
    ['onMain', undefined, 'branch-not-allowed'],
    ['toolVersion', '27.2.0', 'locked-eas-cli-mismatch'],
    ['expectedToolVersion', marker, 'locked-eas-cli-mismatch'],
    ['profileValid', 'true', 'production-profile-invalid']
  ])('fails closed for %s=%s', (field, value, blocker) => {
    const result = createPreflight({ ...input(), [field]: value });
    expect(result.localChecksPass).toBe(false);
    expect(result.blockers).toContain(blocker);
    expect(result.exitCode).toBe(2);
    expect(result.readyToBuild).toBe(false);
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it('distinguishes passing local checks from missing or exhausted external capacity', () => {
    const missing = createPreflight({ ...input(), usage: undefined });
    expect(missing).toMatchObject({ localChecksPass: true, exitCode: 2,
      usageObservationSource: 'none', blockers: ['capacity-unobserved'] });
    const source = usage();
    source.builds.plan.used = 30;
    expect(createPreflight({ ...input(), usage: source })).toMatchObject({
      localChecksPass: true, exitCode: 2, blockers: ['capacity-exhausted'], readyToBuild: false
    });
  });
});

describe('strict preflight arguments', () => {
  it('requires a source and accepts the explicit paired stdin observation', () => {
    expect(parseArguments(['--source-sha', sha.toUpperCase()])).toEqual({
      expectedSha: sha, usageJsonStdin: false, observedAt: null
    });
    expect(parseArguments(['--observed-at', observedAt, '--usage-json-stdin', '--source-sha', sha])).toEqual({
      expectedSha: sha, usageJsonStdin: true, observedAt
    });
  });

  it.each([
    [], ['--source-sha'], ['--source-sha', 'a'.repeat(39)],
    ['--source-sha', sha, '--source-sha', sha],
    ['--source-sha', sha, '--usage-json-stdin'],
    ['--source-sha', sha, '--observed-at', observedAt],
    ['--source-sha', sha, '--usage-json-stdin', '--observed-at', observedAt, '--usage-json-stdin'],
    ['--source-sha', sha, '--usage-json-stdin', '--observed-at', '2026-02-30T00:00:00Z'],
    ['--source-sha', sha, '--password', marker]
  ].map(args => [args]))('rejects malformed, duplicate or unknown flags: %j', (args) => {
    expect(() => parseArguments(args)).toThrow(/^Invalid preflight arguments\.$/);
  });
});

describe('read-only local Git state', () => {
  it.each([['main', true], ['HEAD', null], ['codex/offline-fixture', false]])('represents branch %s without returning its name', (branch, onMain) => {
    const git = vi.fn(args => {
      if (args.includes('--abbrev-ref')) return branch;
      if (args[0] === 'status') return '';
      return sha;
    });
    expect(readLocalGitState(git)).toEqual({ actualSha: sha, clean: true, onMain });
  });

  it('treats porcelain modifications as dirty without returning filenames', () => {
    const git = args => args[0] === 'status' ? ` M ${marker}`
      : args.includes('--abbrev-ref') ? 'codex/offline-fixture' : sha;
    const result = readLocalGitState(git);
    expect(result).toEqual({ actualSha: sha, clean: false, onMain: false });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it('reads only selected current Git state using the real platform-safe local configuration', () => {
    const result = readLocalGitState();
    expect(result.actualSha).toMatch(/^[0-9a-f]{40}$/i);
    expect(typeof result.clean).toBe('boolean');
    expect([true, false, null]).toContain(result.onMain);
    expect(Object.keys(result).sort()).toEqual(['actualSha', 'clean', 'onMain']);
  });
});

describe('bounded, redacted usage stdin', () => {
  it('parses chunked JSON and releases its owned stream listeners', async () => {
    const raw = Buffer.from(JSON.stringify(usage()));
    const stream = Readable.from([raw.subarray(0, 17), raw.subarray(17)]);
    await expect(readUsageInput(stream)).resolves.toEqual(usage());
    expectReleased(stream);
  });

  it('accepts exactly 64 KiB but rejects the next byte', async () => {
    const overhead = Buffer.byteLength(JSON.stringify({ padding: '' }));
    const raw = JSON.stringify({ padding: 'x'.repeat(65_536 - overhead) });
    expect(Buffer.byteLength(raw)).toBe(65_536);
    const value = await readUsageInput(Readable.from([raw]));
    expect(value.padding).toHaveLength(65_536 - overhead);
    await expect(readUsageInput(Readable.from([raw, ' ']))).rejects.toThrow(/^Invalid or unavailable usage JSON input\.$/);
  });

  it('counts UTF-8 bytes rather than JavaScript characters', async () => {
    const raw = JSON.stringify({ label: 'éé' });
    expect(Buffer.byteLength(raw)).toBeGreaterThan(raw.length);
    await expect(readUsageInput(Readable.from([raw]), { maxBytes: raw.length })).rejects.toThrow(/^Invalid or unavailable usage JSON input\.$/);
  });

  it.each(['null', '[]', `{"password":"${marker}",`])('rejects non-object or malformed JSON without exposing input', async (raw) => {
    const stream = Readable.from([raw]);
    await expect(readUsageInput(stream)).rejects.toThrow(/^Invalid or unavailable usage JSON input\.$/);
    expect(stream.destroyed).toBe(true);
    expectReleased(stream);
  });

  it('expires an unfinished stream after five seconds and clears timers/listeners', async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const pending = expect(readUsageInput(stream)).rejects.toThrow(/^Invalid or unavailable usage JSON input\.$/);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(stream.destroyed).toBe(true);
    expectReleased(stream);
  });

  it('redacts a source stream error and cleans up before rejecting', async () => {
    const stream = new PassThrough();
    const pending = expect(readUsageInput(stream)).rejects.toThrow(/^Invalid or unavailable usage JSON input\.$/);
    stream.emit('error', new Error(marker));
    await pending;
    expect(stream.destroyed).toBe(true);
    expectReleased(stream);
  });
});

describe('offline preflight command boundary', () => {
  it('does not inspect source or consume stdin for invalid arguments', async () => {
    const stream = new PassThrough();
    const resume = vi.spyOn(stream, 'resume');
    const options = cliOptions();
    expect(await runCli(['--password', marker], stream, options)).toBe(2);
    expect(options.inspect).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(options.writeOut).not.toHaveBeenCalled();
    expect(options.writeError).toHaveBeenCalledOnce();
    expect(options.writeError.mock.calls[0][0]).not.toContain(marker);
    stream.destroy();
  });

  it('does not consume stdin without its explicit flag and reports missing capacity', async () => {
    const stream = new PassThrough();
    const resume = vi.spyOn(stream, 'resume');
    const options = cliOptions();
    expect(await runCli(['--source-sha', sha], stream, options)).toBe(2);
    expect(resume).not.toHaveBeenCalled();
    expect(options.inspect).toHaveBeenCalledWith(sha);
    expect(JSON.parse(options.writeOut.mock.calls[0][0])).toMatchObject({
      mode: 'offline', capacity: { status: 'unobserved' }, buildStarted: false, submissionStarted: false
    });
    stream.destroy();
  });

  it('reports available supplied usage without claiming authentication, signing readiness or a started build', async () => {
    const options = cliOptions();
    const stream = Readable.from([JSON.stringify({ ...usage(), password: marker })]);
    expect(await runCli(['--source-sha', sha, '--usage-json-stdin', '--observed-at', observedAt], stream, options)).toBe(0);
    const report = JSON.parse(options.writeOut.mock.calls[0][0]);
    expect(report).toMatchObject({ usageObservationSource: 'supplied-json-not-authenticated',
      capacity: { status: 'available-as-observed' }, readyToBuild: false, buildStarted: false, submissionStarted: false });
    expect(JSON.stringify(report)).not.toContain(marker);
    expect(options.writeError).not.toHaveBeenCalled();
  });

  it('stops malformed stdin before source inspection and suppresses parser input', async () => {
    const options = cliOptions();
    const stream = Readable.from([`{"password":"${marker}",`]);
    expect(await runCli(['--source-sha', sha, '--usage-json-stdin', '--observed-at', observedAt], stream, options)).toBe(2);
    expect(options.inspect).not.toHaveBeenCalled();
    expect(options.writeOut).not.toHaveBeenCalled();
    expect(options.writeError.mock.calls[0][0]).not.toContain(marker);
  });

  it('suppresses command failures, including captured stderr and termination metadata', async () => {
    const options = cliOptions();
    const error = Object.assign(new Error(marker), {
      stderr: Buffer.from(marker), stdout: Buffer.from(marker), signal: 'SIGTERM', code: marker
    });
    options.inspect.mockImplementation(async () => readLocalGitState(() => { throw error; }));
    expect(await runCli(['--source-sha', sha], new PassThrough(), options)).toBe(2);
    expect(options.writeOut).not.toHaveBeenCalled();
    expect(options.writeError).toHaveBeenCalledWith('Player build preflight stopped: invalid input or unavailable local checks. No build or submission was started.\n');
    expect(options.writeError.mock.calls[0][0]).not.toContain(marker);
  });
});
