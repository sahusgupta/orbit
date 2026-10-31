import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import discovery from './discovery.cjs';

const root = process.cwd();
const launcher = path.join(root, 'scripts/measure-api-resources.mjs');
const runtimeNames = ['PATH', 'Path', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const environment = Object.fromEntries(runtimeNames.filter((name) => process.env[name] !== undefined)
  .map((name) => [name, process.env[name]]));

describe('isolated discovery resource measurement', () => {
  it('counts batch document requests once even when the backing memory store delegates to individual reads', async () => {
    const source = {
      async getDocument(documentPath) { return documentPath.includes('missing') ? null : { found: true }; },
      async getDocuments(paths) { return Promise.all(paths.map((documentPath) => this.getDocument(documentPath))); },
      async queryCollection() { return [{ id: 'one' }, { id: 'two' }]; }
    };
    const counted = discovery.countStore(source);
    await counted.store.getDocuments(['orbitAccountStates/a/stateChunks/1', 'orbitAccountStates/a/stateChunks/missing']);
    await counted.store.getDocument('orbitPublicationOutbox/a');
    await counted.store.queryCollection('orbitAccountStates', { limit: 2 });
    expect(counted.counts).toEqual({
      singleReadRequests: 1, batchReadRequests: 1, queryRequests: 1,
      publicationDocumentsRequested: 1, chunkDocumentsRequested: 2, otherDocumentsRequested: 0,
      queryDocumentsReturned: 2, missingDocuments: 1, writes: 0
    });
  });

  it('measures actual paginated discovery with no inherited service configuration or network access', () => {
    const output = execFileSync(process.execPath, [launcher, '--scenario', 'discovery', '--samples', '2'], {
      cwd: root, windowsHide: true, encoding: 'utf8', timeout: 20_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...environment, FIREBASE_SERVICE_ACCOUNT_JSON: 'invalid-synthetic-fixture',
        GOOGLE_APPLICATION_CREDENTIALS: 'not-a-real-credential-file', ORBIT_API_URL: 'https://unused.example.invalid' }
    });
    const report = JSON.parse(output);
    expect(report.isolated).toBe(true);
    expect(report.networkAttempts).toBe(0);
    expect(report.sourceSha).toMatch(/^[a-f0-9]{40}$/);
    expect(Object.values(report.sourceFiles).every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    const expected = [
      [1, 1, 1, 0, 1, 1], [25, 1, 25, 0, 25, 25],
      [50, 1, 50, 0, 50, 25], [200, 1, 51, 0, 50, 25],
      [200, 2, 102, 0, 100, 50], [200, 4, 203, 0, 200, 0],
      [50, 1, 50, 0, 50, 25], [1, 1, 1, 0, 1, 1]
    ];
    expect(report.scenarios).toHaveLength(expected.length);
    for (const [index, sample] of report.scenarios.entries()) {
      const [venues, queries, headers, publications, chunks, returned] = expected[index];
      expect(sample.setup.venues).toBe(venues);
      expect(sample.operations.queryRequests).toBe(queries);
      expect(sample.operations.queryDocumentsReturned).toBe(headers);
      expect(sample.operations.publicationDocumentsRequested).toBe(publications);
      expect(sample.operations.chunkDocumentsRequested).toBe(chunks);
      expect(sample.operations.writes).toBe(0);
      expect(sample.response.returnedClubs).toBe(returned);
      expect(sample.response.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(sample.samples).toBe(2);
      expect(sample.memorySamples).toHaveLength(2);
    }
    const hidden = report.scenarios[5];
    expect(hidden.operations.licenseCheckBatches).toBe(0);
    expect(hidden.response.page).toEqual({ count: 0, hasMore: false, nextCursor: null });
    expect(report.scenarios[3].response.page).toEqual({ count: 25, hasMore: true, nextCursor: 'synthetic-club-0024' });
  }, 25_000);

  it.each([
    ['--samples', '0'], ['--samples', '26'], ['--scenario', 'production'],
    ['--output', '../outside.json'], ['--output', 'out/../AGENTS.md'], ['--output', 'out/result.txt']
  ])('rejects unsafe or invalid arguments %s %s', (...args) => {
    const result = spawnSync(process.execPath, [launcher, ...args], {
      cwd: root, env: environment, windowsHide: true, encoding: 'utf8', timeout: 5_000
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Usage:|output must be/);
    expect(result.stdout).toBe('');
  });

  it('refuses output paths that traverse a directory symlink or Windows junction', () => {
    mkdirSync(path.join(root, 'out'), { recursive: true });
    const directory = mkdtempSync(path.join(root, 'out/baseline-link-check-'));
    const target = path.join(directory, 'target');
    const link = path.join(directory, 'link');
    mkdirSync(target);
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const result = spawnSync(process.execPath, [launcher, '--output', path.join(link, 'result.json')], {
        cwd: root, env: environment, windowsHide: true, encoding: 'utf8', timeout: 5_000
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('must not traverse a symlink or junction');
      expect(existsSync(path.join(target, 'result.json'))).toBe(false);
    } finally {
      unlinkSync(link);
      rmdirSync(target);
      rmdirSync(directory);
    }
  });
});
