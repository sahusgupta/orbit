import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mocked = vi.hoisted(() => ({ spawnSync: vi.fn(), bundled: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: mocked.spawnSync }));
vi.mock('./audit-bundled-runtime-dependencies.mjs', () => ({ auditBundledRuntimeDependencies: mocked.bundled }));

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const importGate = () => import('./audit-production-dependencies.mjs');
const counts = () => ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 });
function report() {
  return { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: counts() } };
}
function result(value = report(), overrides = {}) {
  return { status: 0, signal: null, stdout: JSON.stringify(value), stderr: '', ...overrides };
}
function findingReport() {
  const value = report();
  value.vulnerabilities['unreviewed-package'] = {
    name: 'unreviewed-package', severity: 'high', nodes: ['node_modules/unreviewed-package'],
    via: [{ url: 'https://github.com/advisories/GHSA-test-fixture', severity: 'high' }]
  };
  value.metadata.vulnerabilities.high = 1;
  value.metadata.vulnerabilities.total = 1;
  return value;
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-31T23:30:00.000Z'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocked.spawnSync.mockImplementation(() => result());
  mocked.bundled.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('production dependency gate existing contracts', () => {
  it('audits the four fixed production scopes and calls the bundled gate only after all four', async () => {
    mocked.bundled.mockImplementation(async (root) => {
      expect(root).toBe(repositoryRoot);
      expect(mocked.spawnSync).toHaveBeenCalledTimes(4);
    });
    await importGate();
    const prefixes = [undefined, 'apps/api', 'player-app', 'player-web'];
    prefixes.forEach((prefix, index) => {
      const args = ['audit', '--omit=dev', '--json', ...(prefix ? ['--prefix', prefix] : [])];
      const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
      const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;
      expect(mocked.spawnSync).toHaveBeenNthCalledWith(index + 1, command, commandArgs, {
        cwd: repositoryRoot, encoding: 'utf8', windowsHide: true
      });
    });
    expect(mocked.bundled).toHaveBeenCalledTimes(1);
  });

  it.each([0, 1])('rejects an unreviewed positive report with status %s under the real policy', async (status) => {
    mocked.spawnSync.mockReturnValueOnce(result(findingReport(), { status }));
    await expect(importGate()).rejects.toThrow('unreviewed-package (high) is not in the reviewed policy');
    expect(mocked.spawnSync).toHaveBeenCalledTimes(4);
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it('preserves the original npm spawn error', async () => {
    const error = new Error('fixture spawn failure');
    mocked.spawnSync.mockReturnValueOnce(result(report(), { error }));
    await expect(importGate()).rejects.toBe(error);
    expect(mocked.spawnSync).toHaveBeenCalledTimes(1);
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON before reaching the bundled gate', async () => {
    mocked.spawnSync.mockReturnValueOnce(result(report(), { stdout: '{broken' }));
    await expect(importGate()).rejects.toThrow('non-JSON output for root');
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it('preserves a valid npm error report as a failure', async () => {
    mocked.spawnSync.mockReturnValueOnce(result({ error: { code: 'EAUDITFIXTURE', summary: 'fixture registry failure' } }, { status: 1 }));
    await expect(importGate()).rejects.toThrow();
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it('rejects expired policy before invoking npm or the bundled gate', async () => {
    vi.mocked(Date.now).mockReturnValue(Date.parse('2026-11-09T00:00:00.000Z'));
    await expect(importGate()).rejects.toThrow('Dependency advisory policy expired');
    expect(mocked.spawnSync).not.toHaveBeenCalled();
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it('preserves a bundled-gate rejection after four valid scope reports', async () => {
    const error = new Error('fixture bundled rejection');
    mocked.bundled.mockRejectedValueOnce(error);
    await expect(importGate()).rejects.toBe(error);
    expect(mocked.spawnSync).toHaveBeenCalledTimes(4);
  });
});

const invalidResults = [
  ['null error field', () => result({ ...report(), error: null })],
  ['false error field', () => result({ ...report(), error: false })],
  ['zero error field', () => result({ ...report(), error: 0 })],
  ['empty error field', () => result({ ...report(), error: '' })],
  ['empty stdout', () => result(report(), { stdout: '' })],
  ['whitespace stdout', () => result(report(), { stdout: '  \r\n\t' })],
  ['empty object', () => result({})],
  ['missing vulnerabilities', () => { const value = report(); delete value.vulnerabilities; return result(value); }],
  ['null vulnerabilities', () => result({ ...report(), vulnerabilities: null })],
  ['array vulnerabilities', () => result({ ...report(), vulnerabilities: [] })],
  ['missing metadata', () => { const value = report(); delete value.metadata; return result(value); }],
  ['missing vulnerability counts', () => result({ ...report(), metadata: {} })],
  ['null vulnerability counts', () => result({ ...report(), metadata: { vulnerabilities: null } })],
  ['array vulnerability counts', () => result({ ...report(), metadata: { vulnerabilities: [] } })],
  ['missing report version', () => { const value = report(); delete value.auditReportVersion; return result(value); }],
  ['wrong report version', () => result({ ...report(), auditReportVersion: 1 })],
  ['string report version', () => result({ ...report(), auditReportVersion: '2' })],
  ['array report', () => result([])],
  ['status two despite a zero report', () => result(report(), { status: 2 })],
  ['status one despite a zero report', () => result(report(), { status: 1 })],
  ['missing process status', () => result(report(), { status: undefined })],
  ['null process status', () => result(report(), { status: null })],
  ['string process status', () => result(report(), { status: '0' })],
  ['signal despite a zero report', () => result(report(), { signal: 'SIGTERM' })],
  ['negative count', () => { const value = report(); value.metadata.vulnerabilities.low = -1; return result(value); }],
  ['string count', () => { const value = report(); value.metadata.vulnerabilities.low = '0'; return result(value); }],
  ['fractional count', () => { const value = report(); value.metadata.vulnerabilities.low = 0.5; return result(value); }],
  ['unsafe integer count', () => { const value = report(); value.metadata.vulnerabilities.total = Number.MAX_SAFE_INTEGER + 1; return result(value); }],
  ['null count', () => { const value = report(); value.metadata.vulnerabilities.info = null; return result(value); }],
  ['missing info count', () => { const value = report(); delete value.metadata.vulnerabilities.info; return result(value); }],
  ['inconsistent total', () => { const value = report(); value.metadata.vulnerabilities.total = 1; return result(value); }],
  ['positive counts without entries', () => { const value = report(); value.metadata.vulnerabilities.high = 1; value.metadata.vulnerabilities.total = 1; return result(value); }],
  ['entry key and name mismatch', () => {
    const value = findingReport(); value.vulnerabilities['unreviewed-package'].name = 'different-package'; return result(value, { status: 1 });
  }],
  ['severity histogram mismatch', () => {
    const value = findingReport(); value.metadata.vulnerabilities.high = 0; value.metadata.vulnerabilities.low = 1; return result(value, { status: 1 });
  }],
  ['unknown entry severity', () => {
    const value = findingReport(); value.vulnerabilities['unreviewed-package'].severity = 'unknown'; return result(value, { status: 1 });
  }]
];

describe('production dependency gate fails closed on malformed audit evidence', () => {
  it.each(invalidResults)('rejects %s before later scopes or bundled work', async (_label, create) => {
    mocked.spawnSync.mockReturnValueOnce(create());
    await expect(importGate()).rejects.toThrow();
    expect(mocked.spawnSync).toHaveBeenCalledTimes(1);
    expect(mocked.bundled).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3])('rejects an invalid process result in scope index %s', async (index) => {
    for (let prior = 0; prior < index; prior += 1) mocked.spawnSync.mockReturnValueOnce(result());
    mocked.spawnSync.mockReturnValueOnce(result(report(), { status: 2 }));
    await expect(importGate()).rejects.toThrow();
    expect(mocked.spawnSync).toHaveBeenCalledTimes(index + 1);
    expect(mocked.bundled).not.toHaveBeenCalled();
  });
});
