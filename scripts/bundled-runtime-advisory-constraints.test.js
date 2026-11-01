import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createBundledAuditFixture, reviewBundledRuntimeAdvisories } from './bundled-runtime-advisory-constraints.mjs';

const origin = () => ({ source: 1244012, name: 'minimatch', dependency: 'minimatch',
  url: 'https://github.com/advisories/GHSA-g3hv-75wg-m249', severity: 'moderate', range: '<11.0.1' });
const versions = { exceljs: '3.10.0', archiver: '4.0.2', 'archiver-utils': '2.1.0',
  'zip-stream': '3.0.1', glob: '7.2.3', minimatch: '3.1.5', rimraf: '2.6.3' };
const paths = Object.fromEntries(Object.keys(versions).map((name) => [name,
  name === 'minimatch' ? 'node_modules/glob/node_modules/minimatch' : `node_modules/${name}`]));
const node = (version, dependencies = {}, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/synthetic/-/synthetic-${version}.tgz`,
  integrity: 'sha512-Zml4dHVyZQ==', dependencies, ...extra });

function source() {
  return {
    manifest: { name: 'synthetic-app', dependencies: { exceljs: '^3.4.0' },
      devDependencies: { 'unrelated-tool': '1.0.0' }, overrides: { 'brace-expansion': '5.0.12' }, engines: { node: '22.16.0' }, packageManager: 'npm@10.9.2' },
    lock: { name: 'synthetic-app', version: '1.0.0', lockfileVersion: 3, packages: {
      '': { name: 'synthetic-app', version: '1.0.0', dependencies: { exceljs: '^3.4.0' } },
      [paths.exceljs]: node(versions.exceljs, { archiver: '^4', rimraf: '^2' }),
      [paths.archiver]: node(versions.archiver, { 'archiver-utils': '^2', glob: '^7', 'zip-stream': '^3' }),
      [paths['archiver-utils']]: node(versions['archiver-utils'], { glob: '^7' }),
      [paths['zip-stream']]: node(versions['zip-stream'], { 'archiver-utils': '^2' }),
      [paths.glob]: node(versions.glob, { minimatch: '^3' }),
      [paths.minimatch]: node(versions.minimatch),
      [paths.rimraf]: node(versions.rimraf, { glob: '^7' }),
      'node_modules/unrelated-tool': node('1.0.0', {}, { dev: true })
    } }
  };
}

function current() {
  const input = source();
  const fixture = createBundledAuditFixture(input.manifest, input.lock, 'exceljs');
  const via = { exceljs: ['archiver'], archiver: ['archiver-utils', 'glob', 'zip-stream'],
    'archiver-utils': ['glob'], 'zip-stream': ['archiver-utils'], glob: ['minimatch'], minimatch: [origin()], rimraf: ['glob'] };
  const report = { auditReportVersion: 2, vulnerabilities: Object.fromEntries(Object.keys(versions).map((name) => [name, {
    name, severity: 'moderate', range: '*', nodes: [paths[name]], via: via[name]
  }])), metadata: { vulnerabilities: { info: 0, low: 0, moderate: 7, high: 0, critical: 0, total: 7 } } };
  const review = { packageName: 'exceljs', version: versions.exceljs, browserEntrySha256: 'a'.repeat(64),
    reviewedNodeVersions: Object.fromEntries(Object.entries(paths).map(([name, nodePath]) => [nodePath, versions[name]])),
    reviewedNodeOrigins: [{ name: 'minimatch', url: origin().url, severity: 'moderate', range: '<11.0.1' }] };
  const proof = { valid: true, version: review.version, browserEntrySha256: review.browserEntrySha256 };
  return { input, fixture, report, review, proof };
}
const check = (value) => reviewBundledRuntimeAdvisories(value.report, value.fixture.lock, value.review, value.proof);
const blocked = (value) => { const result = check(value); expect(result.failures.length).toBeGreaterThan(0); expect(result.dispositions).toEqual([]); return result; };

describe('audit-only bundled dependency fixture', () => {
  it('derives the actual ExcelJS closure without other development glob versions or source mutations', () => {
    const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
    const original = JSON.stringify({ manifest, lock });
    const fixture = createBundledAuditFixture(manifest, lock, 'exceljs');
    expect(fixture.manifest.dependencies).toEqual({ exceljs: '3.10.0' });
    expect(fixture.manifest.overrides).toEqual(manifest.overrides);
    expect(fixture.lock.name).toBe(fixture.manifest.name);
    expect(fixture.lock.packages['']).toEqual({ name: fixture.manifest.name, version: '0.0.0',
      dependencies: { exceljs: '3.10.0' }, engines: manifest.engines });
    expect(fixture.nodePaths).toContain('node_modules/glob/node_modules/minimatch');
    expect(fixture.nodePaths).not.toContain('node_modules/@expo/config/node_modules/glob');
    for (const nodePath of fixture.nodePaths) {
      const expected = structuredClone(lock.packages[nodePath]);
      delete expected.dev;
      delete expected.devOptional;
      expect(fixture.lock.packages[nodePath]).toEqual(expected);
    }
    expect(JSON.stringify({ manifest, lock })).toBe(original);
  });

  it('uses nearest nested/scoped resolutions and terminates legitimate dependency cycles', () => {
    const value = source();
    value.lock.packages[paths.exceljs].dependencies = { a: '1', '@scope/a': '1' };
    value.lock.packages['node_modules/a'] = node('1.0.0', { b: '2' });
    value.lock.packages['node_modules/a/node_modules/b'] = node('2.0.0', { a: '1' });
    value.lock.packages['node_modules/b'] = node('9.0.0');
    value.lock.packages['node_modules/@scope/a'] = node('1.0.0', { '@scope/b': '1' });
    value.lock.packages['node_modules/@scope/a/node_modules/@scope/b'] = node('1.0.0');
    const fixture = createBundledAuditFixture(value.manifest, value.lock, 'exceljs');
    expect(fixture.nodePaths).toEqual([paths.exceljs, 'node_modules/@scope/a',
      'node_modules/@scope/a/node_modules/@scope/b', 'node_modules/a', 'node_modules/a/node_modules/b'].sort());
    expect(fixture.lock.packages['node_modules/a/node_modules/b'].version).toBe('2.0.0');
  });

  it('keeps installed optional dependencies, tolerates missing optionals and preserves non-development metadata', () => {
    const value = source();
    value.lock.packages[paths.exceljs].dependencies = { optional: '1' };
    value.lock.packages[paths.exceljs].optionalDependencies = { optional: '1', absent: '1' };
    value.lock.packages['node_modules/optional'] = node('1.0.0', {}, { dev: true, devOptional: true, optional: true, license: 'MIT' });
    const fixture = createBundledAuditFixture(value.manifest, value.lock, 'exceljs');
    expect(fixture.nodePaths).toEqual([paths.exceljs, 'node_modules/optional']);
    expect(fixture.lock.packages['node_modules/optional']).toMatchObject({ optional: true, license: 'MIT' });
    expect(fixture.lock.packages['node_modules/optional']).not.toHaveProperty('dev');
    expect(fixture.lock.packages['node_modules/optional']).not.toHaveProperty('devOptional');
  });

  it('includes installed peers and rejects unresolved required peers', () => {
    const value = source();
    value.lock.packages[paths.exceljs].peerDependencies = { peer: '1', absent: '1' };
    value.lock.packages[paths.exceljs].peerDependenciesMeta = { absent: { optional: true } };
    value.lock.packages['node_modules/peer'] = node('1.0.0');
    expect(createBundledAuditFixture(value.manifest, value.lock, 'exceljs').nodePaths).toContain('node_modules/peer');
    delete value.lock.packages['node_modules/peer'];
    expect(() => createBundledAuditFixture(value.manifest, value.lock, 'exceljs')).toThrow('Required locked dependency peer');
  });

  it.each([
    (value) => { delete value.lock.packages[paths.minimatch]; },
    (value) => { value.lock.packages[paths.glob].dependencies.minimatch = 'file:../unsafe'; },
    (value) => { value.lock.packages[paths.minimatch].link = true; },
    (value) => { delete value.lock.packages[paths.minimatch].integrity; },
    (value) => { value.lock.packages[paths.minimatch].resolved = 'file:../unsafe'; },
    (value) => { delete value.lock.packages[paths.minimatch].version; },
    (value) => { value.manifest.overrides = { minimatch: 'file:../unsafe' }; },
    (value) => { value.lock.lockfileVersion = 1; }
  ])('rejects incomplete, linked or non-registry input %#', (mutate) => {
    const value = source(); mutate(value);
    expect(() => createBundledAuditFixture(value.manifest, value.lock, 'exceljs')).toThrow();
  });

  it.each([
    'github:owner/repo', 'gitlab:owner/repo', 'owner/repo', 'npm:glob@7',
    'git@github.com:owner/repo', 'archive.tgz', 'archive.tar.gz', 'archive.tar',
    '.', '..', '$other', 'file:../unsafe', 'https://example.invalid/archive.tgz',
    'C:\\unsafe', '~/.cache/package', '1.0.0;echo unsafe', '^'.repeat(1025)
  ])('rejects non-registry or unsupported closure specs: %s', (spec) => {
    const value = source();
    value.lock.packages[paths.glob].dependencies.minimatch = spec;
    expect(() => createBundledAuditFixture(value.manifest, value.lock, 'exceljs')).toThrow();
  });

  it.each([
    'github:owner/repo', 'gitlab:owner/repo', 'owner/repo', 'npm:glob@7',
    'git@github.com:owner/repo', 'archive.tgz', 'archive.tar.gz', 'archive.tar',
    '.', '..', '$other', 'file:../unsafe', 'https://example.invalid/archive.tgz',
    'C:\\unsafe', '~/.cache/package', '1.0.0;echo unsafe', '^'.repeat(1025)
  ])('rejects non-registry or unsupported nested override specs: %s', (spec) => {
    const value = source();
    value.manifest.overrides.glob = { minimatch: spec };
    expect(() => createBundledAuditFixture(value.manifest, value.lock, 'exceljs')).toThrow();
  });

  it.each(['^3.1.1', '~2.0.0', '>=0.3.0 <0.4', '>=0.5 0', '2 || 3', '>= 1.0.0 < 4',
    '1.0.0 - 4.0.0', '3', '3.x', '*', 'latest', 'next-1'])('preserves reviewed registry range/tag syntax: %s', (spec) => {
    const value = source();
    value.lock.packages[paths.glob].dependencies.minimatch = spec;
    value.manifest.overrides.glob = { minimatch: spec };
    const fixture = createBundledAuditFixture(value.manifest, value.lock, 'exceljs');
    expect(fixture.lock.packages[paths.glob].dependencies.minimatch).toBe(spec);
    expect(fixture.manifest.overrides.glob.minimatch).toBe(spec);
  });
});

describe('bundled browser runtime advisory retention', () => {
  it('returns visible exact Node-origin dispositions for all seven current propagated entries', () => {
    const value = current();
    const original = JSON.stringify(value);
    const result = check(value);
    expect(result.failures).toEqual([]);
    expect(result.dispositions).toHaveLength(7);
    const exceljs = result.dispositions.find(({ name }) => name === 'exceljs');
    expect(exceljs).toMatchObject({ disposition: 'excluded-node-only', nodes: [{ path: paths.exceljs, version: '3.10.0' }] });
    expect(exceljs.origins.map(({ path }) => path)).toEqual([
      ['exceljs', 'archiver', 'archiver-utils', 'glob', 'minimatch'],
      ['exceljs', 'archiver', 'glob', 'minimatch'],
      ['exceljs', 'archiver', 'zip-stream', 'archiver-utils', 'glob', 'minimatch']
    ]);
    expect(exceljs.origins.every(({ name, url, severity, range }) => name === 'minimatch' && url === origin().url
      && severity === 'moderate' && range === '<11.0.1')).toBe(true);
    expect(JSON.stringify(value)).toBe(original);
  });

  it.each([
    (value) => { value.proof = undefined; },
    (value) => { value.proof.valid = false; },
    (value) => { value.proof.version = '4.4.0'; },
    (value) => { value.proof.browserEntrySha256 = 'b'.repeat(64); },
    (value) => { value.fixture.lock.packages[paths.exceljs].version = '4.4.0'; },
    (value) => { value.review.reviewedNodeVersions[paths.glob] = '8.0.0'; },
    (value) => { delete value.review.reviewedNodeVersions[paths.minimatch]; },
    (value) => { value.fixture.lock.packages[paths.minimatch].version = '10.2.5'; },
    (value) => { delete value.fixture.lock.packages[paths.minimatch].integrity; },
    (value) => { value.review.reviewedNodeOrigins.push({ name: 'other', url: 'unreviewed' }); }
  ])('blocks missing proof, changed artifact or changed resolution %#', (mutate) => {
    const value = current(); mutate(value); blocked(value);
  });

  it('blocks direct ExcelJS findings even alongside the known Node-only origin', () => {
    const value = current();
    value.report.vulnerabilities.exceljs.via.push({ ...origin(), name: 'exceljs', dependency: 'exceljs', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' });
    expect(blocked(value).failures).toContain('A direct ExcelJS advisory affects the shipped browser component.');
  });

  it.each([
    (value) => { value.report.vulnerabilities.glob.via.push({ ...origin(), name: 'glob', dependency: 'glob', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' }); },
    (value) => { value.report.vulnerabilities.minimatch.via[0].url = 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc'; },
    (value) => { value.report.vulnerabilities.minimatch.via[0].range = '*'; },
    (value) => { value.report.vulnerabilities.minimatch.via[0].severity = 'critical'; },
    (value) => { value.report.vulnerabilities.glob.severity = 'critical'; value.report.metadata.vulnerabilities.moderate = 6; value.report.metadata.vulnerabilities.critical = 1; },
    (value) => { value.report.vulnerabilities.glob.via = ['archiver']; },
    (value) => { value.report.vulnerabilities.glob.via = ['missing-advisory']; },
    (value) => { value.report.vulnerabilities.minimatch.via[0].dependency = 'exceljs'; },
    (value) => { delete value.report.vulnerabilities.minimatch.via[0].source; }
  ])('blocks unknown, mixed, critical or cyclic advisory evidence %#', (mutate) => {
    const value = current(); mutate(value); blocked(value);
  });

  it.each([
    (value) => { value.report = null; },
    (value) => { value.report = {}; },
    (value) => { value.report.error = { code: 'NETWORK' }; },
    (value) => { value.report.auditReportVersion = 3; },
    (value) => { value.report.vulnerabilities = []; },
    (value) => { value.report.vulnerabilities.glob.nodes = []; },
    (value) => { value.report.vulnerabilities.glob.range = ''; },
    (value) => { value.report.vulnerabilities.glob.via = []; },
    (value) => { value.report.vulnerabilities.glob.nodes = ['node_modules/missing']; },
    (value) => { value.report.vulnerabilities.glob.nodes.push(paths.glob); },
    (value) => { value.report.metadata.vulnerabilities.total = 0; }
  ])('fails closed for unavailable or malformed audit evidence %#', (mutate) => {
    const value = current(); mutate(value); blocked(value);
  });

  it('accepts a complete empty audit without dropping the artifact proof requirement', () => {
    const value = current();
    value.report.vulnerabilities = {};
    value.report.metadata.vulnerabilities = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
    expect(check(value)).toEqual({ failures: [], dispositions: [] });
    value.proof.valid = false;
    blocked(value);
  });
});
