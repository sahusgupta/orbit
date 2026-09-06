import assert from 'node:assert/strict';

export const playerServiceHosts = Object.freeze([
  'orbitapp-one.vercel.app',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firestore.googleapis.com',
  'firebaseappcheck.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'firebasestorage.googleapis.com',
  'tabletalk-s.firebaseapp.com',
  'tabletalk-s.firebaseio.com'
]);

// Keep the production binary intact while exercising only device-local flows.
// The caller supplies OS operations so restoration and fail-closed ordering can
// be tested without changing a developer machine's networking.
export async function withBlockedPlayerHosts(operations, task) {
  const original = operations.readHosts();
  assert.ok(!playerServiceHosts.some((host) => original.split(/\s+/).includes(host)),
    'The disposable runner already overrides a Player service host.');
  const entries = playerServiceHosts.flatMap((host) => [`127.0.0.1 ${host}`, `::1 ${host}`]);
  try {
    operations.writeHosts(`${original}\n# Orbit local simulator QA\n${entries.join('\n')}\n`);
    operations.flushDns();
    for (const host of playerServiceHosts) {
      const addresses = await operations.resolveHost(host);
      assert.ok(addresses.length && addresses.every(({ address }) => address === '127.0.0.1' || address === '::1'),
        `Player service must resolve only to loopback before app launch: ${host}`);
    }
    await task();
  } finally {
    operations.writeHosts(original);
    operations.flushDns();
  }
}
