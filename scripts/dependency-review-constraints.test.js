import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { dependencyReviewFailures } from './dependency-review-constraints.mjs';

const url = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
function fixture() {
  return {
    entries: [
      { name: 'braces', severity: 'high', nodes: ['node_modules/braces'], via: [{ url, severity: 'high' }] },
      { name: 'metro', severity: 'high', nodes: ['node_modules/metro'], via: ['braces'] }
    ],
    review: { allowed: ['braces', 'metro'], reviewedVersions: { braces: ['3.0.3'], metro: ['0.84.6'] }, reviewedAdvisories: { braces: [url] } },
    lock: { packages: { 'node_modules/braces': { version: '3.0.3' }, 'node_modules/metro': { version: '0.84.6' } } }
  };
}
function check({ entries, review, lock }) { return dependencyReviewFailures('player', entries, review, lock); }

function lowSeverityFixture() {
  const advisory = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';
  return {
    entries: [
      { name: 'deepmerge', severity: 'low', nodes: ['node_modules/deepmerge'], via: [{ url: advisory, severity: 'low' }] },
      { name: '@expo/config', severity: 'low', nodes: ['node_modules/@expo/config'], via: ['deepmerge'] }
    ],
    review: {
      allowed: ['deepmerge', '@expo/config'],
      reviewedVersions: { deepmerge: ['4.3.1'], '@expo/config': ['58.0.9'] },
      reviewedSeverities: { deepmerge: 'low', '@expo/config': 'low' },
      reviewedAdvisories: { deepmerge: [advisory] }
    },
    lock: { packages: { 'node_modules/deepmerge': { version: '4.3.1' }, 'node_modules/@expo/config': { version: '58.0.9' } } }
  };
}

function retiredHighSeverityFixture() {
  const advisory = 'https://github.com/advisories/GHSA-mrhx-c7xc-m3w5';
  return {
    entries: [
      { name: 'zod', severity: 'high', nodes: ['node_modules/zod'], via: [{ url: advisory, severity: 'high' }] },
      { name: '@expo/cli', severity: 'high', nodes: ['node_modules/@expo/cli'], via: ['zod'] }
    ],
    lock: { packages: { 'node_modules/zod': { version: '3.25.76' }, 'node_modules/@expo/cli': { version: '58.1.17' } } }
  };
}

function actualPolicy() {
  return JSON.parse(fs.readFileSync(new URL('../config/dependency-audit-policy.json', import.meta.url), 'utf8'));
}

const retiredPlayerChains = [
  { label: 'Low deepmerge/Config', create: lowSeverityFixture },
  { label: 'High zod/CLI', create: retiredHighSeverityFixture }
];

describe('bounded production advisory review', () => {
  it('accepts only the exact reviewed origin, locked versions, and transitive chain', () => {
    expect(check(fixture())).toEqual([]);
  });
  it('rejects a new advisory on an already allowed package', () => {
    const value = fixture();
    value.entries[0].via.push({ url: 'https://github.com/advisories/GHSA-new-advisory', severity: 'high' });
    expect(check(value).join('\n')).toContain('unreviewed or critical originating advisory');
  });
  it('rejects changed or missing locked versions', () => {
    const value = fixture();
    value.lock.packages['node_modules/braces'].version = '3.0.4';
    expect(check(value).join('\n')).toContain('unreviewed locked version 3.0.4');
    delete value.lock.packages['node_modules/braces'];
    expect(check(value).join('\n')).toContain('unreviewed locked version missing');
  });
  it('rejects critical severity even when the package and advisory are listed', () => {
    const value = fixture();
    value.entries[0].severity = 'critical';
    value.entries[0].via[0].severity = 'critical';
    expect(check(value).join('\n')).toContain('unreviewed severity critical');
    expect(check(value).join('\n')).toContain('critical originating advisory');
  });
  it('rejects an unknown package or transitive origin', () => {
    const value = fixture();
    value.entries[1].via = ['unknown'];
    expect(check(value).join('\n')).toContain('unreviewed dependency unknown');
    value.entries[1].name = 'unknown';
    expect(check(value).join('\n')).toContain('not in the reviewed policy');
  });
  it('rejects absent nodes or originating advisory evidence', () => {
    const value = fixture();
    value.entries[0].nodes = [];
    value.entries[0].via = [];
    expect(check(value).join('\n')).toContain('incomplete advisory evidence');
  });
  it('accepts an explicitly reviewed Low origin and its exact transitive package severity', () => {
    expect(check(lowSeverityFixture())).toEqual([]);
  });
  it('keeps the legacy High default when a package has no explicit severity review', () => {
    const value = lowSeverityFixture();
    delete value.review.reviewedSeverities;
    expect(check(value).join('\n')).toContain('unreviewed severity low');
    expect(check(fixture())).toEqual([]);
  });
  it.each(['info', 'moderate', 'high', 'critical', 'unknown'])('rejects severity drift from reviewed Low to %s', (severity) => {
    const value = lowSeverityFixture();
    value.entries[0].severity = severity;
    expect(check(value).join('\n')).toContain(`unreviewed severity ${severity}`);
  });
  it('rejects originating advisory severity drift even when the package severity is unchanged', () => {
    const value = lowSeverityFixture();
    value.entries[0].via[0].severity = 'high';
    expect(check(value).join('\n')).toContain('unreviewed or critical originating advisory');
  });
  it('rejects Critical even if a policy tries to declare it reviewed', () => {
    const value = lowSeverityFixture();
    value.review.reviewedSeverities.deepmerge = 'critical';
    value.entries[0].severity = 'critical';
    value.entries[0].via[0].severity = 'critical';
    const failures = check(value).join('\n');
    expect(failures).toContain('invalid reviewed severity critical');
    expect(failures).toContain('unreviewed severity critical');
    expect(failures).toContain('critical originating advisory');
  });
  it('rejects new originating advisories on an explicitly reviewed Low package', () => {
    const value = lowSeverityFixture();
    value.entries[0].via.push({ url: 'https://github.com/advisories/GHSA-new-advisory', severity: 'low' });
    expect(check(value).join('\n')).toContain('unreviewed or critical originating advisory');
  });
  it.each(retiredPlayerChains)('rejects the retired $label chain at its formerly reviewed versions under the actual Player policy', ({ create }) => {
    const value = create();
    const policy = actualPolicy();
    expect(dependencyReviewFailures('player', value.entries, policy.scopes.player, value.lock)).toEqual(
      value.entries.map((entry) => `player:${entry.name} is not in the reviewed policy.`)
    );
  });
  it.each(['root', 'api', 'player', 'web'])('keeps the actual %s scope closed to both retired Player chains', (scope) => {
    const policy = actualPolicy();
    expect(policy.scopes[scope].allowed).toEqual([]);
    for (const { create } of retiredPlayerChains) {
      const value = create();
      expect(dependencyReviewFailures(scope, value.entries, policy.scopes[scope], value.lock)).toEqual(
        value.entries.map((entry) => `${scope}:${entry.name} is not in the reviewed policy.`)
      );
    }
  });
});
