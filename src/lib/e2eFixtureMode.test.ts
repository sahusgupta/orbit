import { describe, expect, it } from 'vitest';
import { isIsolatedFixtureEnvironment } from './e2eFixtureMode';

const isolated = {
  fixtureMode: 'true',
  firebaseSync: 'false',
  apiUrl: 'http://127.0.0.1:4185',
  hostname: '127.0.0.1'
};

describe('isolated production-bundle fixture boundary', () => {
  it('permits only the explicit unreachable loopback build and runtime origin', () => {
    expect(isIsolatedFixtureEnvironment(isolated)).toBe(true);
    expect(isIsolatedFixtureEnvironment({ ...isolated, hostname: 'localhost' })).toBe(true);
    expect(isIsolatedFixtureEnvironment({ ...isolated, hostname: '::1' })).toBe(true);
  });

  it('rejects hosted, packaged, synchronized, reachable, and unrequested configurations', () => {
    expect(isIsolatedFixtureEnvironment({ ...isolated, hostname: 'orbit.example' })).toBe(false);
    expect(isIsolatedFixtureEnvironment({ ...isolated, hostname: '' })).toBe(false);
    expect(isIsolatedFixtureEnvironment({ ...isolated, firebaseSync: 'true' })).toBe(false);
    expect(isIsolatedFixtureEnvironment({ ...isolated, apiUrl: 'http://127.0.0.1:3001' })).toBe(false);
    expect(isIsolatedFixtureEnvironment({ ...isolated, fixtureMode: 'false' })).toBe(false);
  });
});
