import { describe, expect, it } from 'vitest';
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
  it('does not carry the Player exception into the root, API, or Web scope', () => {
    const value = fixture();
    value.review = { allowed: [] };
    expect(check(value)).toHaveLength(2);
  });
});
