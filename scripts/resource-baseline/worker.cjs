const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertIsolatedWorker, installNetworkGuard, measure, root } = require('./runtime.cjs');

async function main() {
  assertIsolatedWorker();
  const guard = installNetworkGuard();
  const samples = Number(process.argv[2]);
  const selected = process.argv[3];
  if (!Number.isInteger(samples) || samples < 1 || samples > 25 || !['all', 'discovery', 'publication'].includes(selected)) {
    throw new Error('Invalid isolated worker arguments.');
  }
  const readSourceSha = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
  const sourcePaths = ['apps/api/src/db/state.js', 'apps/api/src/db/connection.js', 'apps/api/src/routes/player.js',
    'apps/api/src/shared/orbitCore.cjs', 'apps/api/src/firebasePublisher.js',
    'scripts/measure-api-resources.mjs', 'scripts/resource-baseline/runtime.cjs',
    'scripts/resource-baseline/discovery.cjs', 'scripts/resource-baseline/publication.cjs', 'scripts/resource-baseline/worker.cjs'];
  const readSourceFiles = () => Object.fromEntries(sourcePaths.map((relativePath) => [relativePath,
    createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')]));
  const sourceSha = readSourceSha();
  const sourceFiles = readSourceFiles();
  const scenarios = [];
  if (selected !== 'publication') {
    const { createDiscoveryScenario } = require('./discovery.cjs');
    for (const options of [
      { venues: 1 }, { venues: 25 }, { venues: 50 }, { venues: 200 },
      { venues: 200, limit: 50 }, { venues: 200, hidden: true },
      { venues: 50, profilesPerVenue: 250 }, { venues: 1, profilesPerVenue: 1000 }
    ]) {
      scenarios.push(await measure(await createDiscoveryScenario(options), samples));
    }
  }
  if (selected !== 'discovery') {
    const { createPublicationScenario } = require('./publication.cjs');
    for (const options of [
      ...[0, 10, 250, 1000].map((players) => ({ players })),
      { players: 10, stalePlayers: 3, legacyPlayers: 2, foreignPlayers: 4 },
      { players: 1000, stalePlayers: 20, legacyPlayers: 10, foreignPlayers: 10 }
    ]) {
      scenarios.push(await measure(createPublicationScenario(options), samples));
    }
  }
  guard.assertUnused();
  assert.equal(readSourceSha(), sourceSha, 'Git HEAD changed during measurement.');
  assert.deepEqual(readSourceFiles(), sourceFiles, 'Measured source changed during measurement.');
  process.stdout.write(JSON.stringify({ schemaVersion: 1, recordedAtUtc: new Date().toISOString(), sourceSha, node: process.version,
    sourceFiles,
    isolated: true, networkAttempts: 0, warmupSamples: 1,
    limitations: [
      'Synthetic in-memory database and REST transport; not production latency, provider billing, or physical-device performance.',
      'Read metrics count requested documents and returned query documents, including pagination sentinels. Empty-query minimum charges, indexes, retries, and real licensing-store reads are excluded.',
      'Timing includes local fixture/database behavior; no artificial network latency is added.',
      'Memory samples are before/after heap and RSS observations, not peak memory or leak proof. GC is requested between samples.',
      'One warm-up per scenario is excluded. Discovery timings exclude fixture setup; publication timings include REST reset/reseed and invariants but exclude module/input setup.',
      'Discovery digests normalize only club.generatedAt; payload bytes use actual responses. Publication uses a fixed VM clock.',
      'Operation counts and response/document digests must be identical across measured samples.'
    ], scenarios }));
}

main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
