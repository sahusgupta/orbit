const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '../..');

function assertIsolatedWorker() {
  assert.equal(process.env.ORBIT_RESOURCE_BASELINE_CHILD, 'true', 'Run through scripts/measure-api-resources.mjs.');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.ORBIT_FIRESTORE_MEMORY, 'true');
  assert.equal(process.env.ORBIT_API_URL, 'http://127.0.0.1:9');
  assert.equal(process.env.ORBIT_ENABLE_FIREBASE_SYNC, 'false');
  assert.equal(process.env.VITE_ENABLE_FIREBASE_SYNC, 'false');
  assert.equal(process.env.ORBIT_ENABLE_EMBEDDED_BACKEND, 'false');
  const inheritedServiceNames = Object.keys(process.env).filter((name) =>
    /^(?:FIREBASE_|GOOGLE_|GCLOUD_|STRIPE_|TWILIO_|SMTP_|REVENUECAT_|VERCEL|NODE_OPTIONS$)/.test(name));
  assert.deepEqual(inheritedServiceNames, [], 'Service configuration must not enter the measurement worker.');
}

function loadCommonJs(relativePath, replacements = {}, globals = {}) {
  const filename = path.resolve(root, relativePath);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, Date, JSON, URL, URLSearchParams,
    process, console, setTimeout, clearTimeout, AbortController,
    require(name) {
      return Object.hasOwn(replacements, name) ? replacements[name] : localRequire(name);
    },
    ...globals
  }, { filename });
  return module.exports;
}

function installNetworkGuard() {
  let attempts = 0;
  const deny = () => {
    attempts += 1;
    throw new Error('Network access is forbidden in the resource baseline.');
  };
  for (const [name, methods] of [
    ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
    ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
    ['node:dgram', ['createSocket']]
  ]) {
    const module = require(name);
    for (const method of methods) module[method] = deny;
  }
  globalThis.fetch = deny;
  return { assertUnused() { assert.equal(attempts, 0, 'An application path attempted network access.'); } };
}

async function measure(operation, samples) {
  await operation(); // Warm-up is excluded from timings and resource counters.
  const records = [];
  for (let index = 0; index < samples; index += 1) {
    if (globalThis.gc) globalThis.gc();
    const before = process.memoryUsage();
    const started = performance.now();
    const result = await operation();
    const durationMs = performance.now() - started;
    const after = process.memoryUsage();
    records.push({ result, durationMs, heapBeforeBytes: before.heapUsed, heapAfterBytes: after.heapUsed,
      heapDeltaBytes: after.heapUsed - before.heapUsed, rssBeforeBytes: before.rss, rssAfterBytes: after.rss });
  }
  const canonical = JSON.stringify(records[0].result);
  for (const record of records) assert.equal(JSON.stringify(record.result), canonical, 'Operation counts/output changed across samples.');
  const durations = records.map((record) => record.durationMs).sort((left, right) => left - right);
  return {
    ...records[0].result,
    samples: records.length,
    durationMs: { min: durations[0], median: durations[Math.floor(durations.length / 2)], max: durations.at(-1) },
    memorySamples: records.map(({ result: _result, durationMs: _duration, ...memory }) => memory)
  };
}

module.exports = { assertIsolatedWorker, installNetworkGuard, loadCommonJs, measure, root };
