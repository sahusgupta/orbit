import { describe, expect, it } from 'vitest';
import releaseVersion from './releaseVersion.js';

const { getReleaseVersion } = releaseVersion;
const sha = '1234567890abcdef1234567890abcdef12345678';

describe('public API release traceability', () => {
  it('exposes only a validated full source SHA and package version', () => {
    expect(getReleaseVersion({ ORBIT_RELEASE_SHA: sha.toUpperCase(), PRIVATE_SETTING: 'do-not-publish' }))
      .toEqual({ ok: true, service: 'orbit-api', version: expect.any(String), sourceSha: sha });
  });
  it('supports provider source metadata without inventing a source revision', () => {
    expect(getReleaseVersion({ VERCEL_GIT_COMMIT_SHA: sha }).sourceSha).toBe(sha);
    for (const candidate of ['', 'main', 'abc123', `${sha}-dirty`, 'https://private.invalid']) {
      expect(getReleaseVersion({ ORBIT_RELEASE_SHA: candidate })).toMatchObject({ ok: false, sourceSha: null });
    }
  });
  it('does not conceal invalid explicit deployment metadata behind provider fallback', () => {
    expect(getReleaseVersion({ ORBIT_RELEASE_SHA: 'invalid', VERCEL_GIT_COMMIT_SHA: sha }).ok).toBe(false);
  });
});
