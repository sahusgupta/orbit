import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const maximumObservationAgeMs = 15 * 60 * 1000;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isSha = value => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return null;
  const canonical = value.length === 20 ? value.replace('Z', '.000Z') : value;
  const milliseconds = Date.parse(canonical);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== canonical) return null;
  return { canonical, milliseconds };
}

// Input is the pinned EAS account:usage JSON envelope, not a build log. Never
// copy its account, billing, URLs, environment or unknown fields into the report.
export function assessUsage(usage, observedAt, now, expectedAccount) {
  const result = { status: 'unobserved', total: null, ios: null, observedAt: null, cycleEnd: null };
  if (usage === undefined || usage === null) return result;
  result.status = 'invalid';
  if (!isRecord(usage) || !isRecord(usage.account) || !isRecord(usage.builds)) return result;
  if (typeof expectedAccount !== 'string' || !expectedAccount) return result;
  if (usage.account.name !== expectedAccount) return { ...result, status: 'account-mismatch' };
  // Paid plans use credits/overages; their totals must not be treated as a free
  // build-count allowance or as permission to incur additional charges.
  if (usage.account.plan !== 'Free') return { ...result, status: 'unsupported-plan' };
  const observed = timestamp(observedAt);
  const current = timestamp(now);
  const start = timestamp(usage.account.billingPeriod?.start);
  const end = timestamp(usage.account.billingPeriod?.end);
  const total = usage.builds.plan;
  const ios = usage.builds.ios?.plan;
  if (!observed || !current || !start || !end || start.milliseconds >= end.milliseconds
    || !isRecord(total) || !isRecord(ios)
    || !isCount(total.used) || !isCount(total.limit) || total.limit === 0
    || !isCount(ios.used) || !isCount(ios.limit) || ios.limit === 0
    || ios.used > total.used || ios.limit > total.limit) return result;
  // Invalid/future or expired-cycle observations never establish a reset.
  if (observed.milliseconds > current.milliseconds) return result;
  if (current.milliseconds - observed.milliseconds > maximumObservationAgeMs
    || observed.milliseconds < start.milliseconds || observed.milliseconds >= end.milliseconds
    || current.milliseconds < start.milliseconds || current.milliseconds >= end.milliseconds) {
    return { ...result, status: 'stale' };
  }
  const counts = plan => ({ used: plan.used, limit: plan.limit, remaining: Math.max(0, plan.limit - plan.used) });
  return {
    status: total.used >= total.limit || ios.used >= ios.limit ? 'exhausted' : 'available-as-observed',
    total: counts(total), ios: counts(ios), observedAt: observed.canonical, cycleEnd: end.canonical
  };
}

export function createPreflight(input) {
  const blockers = [];
  if (!isSha(input.expectedSha) || !isSha(input.actualSha)
    || input.expectedSha.toLowerCase() !== input.actualSha.toLowerCase()) blockers.push('source-mismatch');
  if (input.clean !== true) blockers.push('uncommitted-source');
  if (input.onMain !== false) blockers.push('branch-not-allowed');
  if (typeof input.expectedToolVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(input.expectedToolVersion)
    || input.toolVersion !== input.expectedToolVersion) blockers.push('locked-eas-cli-mismatch');
  if (input.profileValid !== true) blockers.push('production-profile-invalid');
  const localChecksPass = blockers.length === 0;
  const capacity = assessUsage(input.usage, input.observedAt, input.now, input.expectedAccount);
  if (capacity.status !== 'available-as-observed') blockers.push(`capacity-${capacity.status}`);
  return {
    mode: 'offline', localChecksPass, capacity, blockers,
    usageObservationSource: input.usage === undefined || input.usage === null ? 'none' : 'supplied-json-not-authenticated',
    sourceSha: isSha(input.actualSha) ? input.actualSha.toLowerCase() : null,
    buildStarted: false, submissionStarted: false, readyToBuild: false,
    externalGatesNotVerified: [
      'fresh-exact-head-ci', 'reviewed-source-archive', 'live-account-and-project',
      'apple-signing-and-credentials', 'explicit-build-confirmation'
    ],
    exitCode: blockers.length === 0 ? 0 : 2
  };
}

export function parseArguments(args) {
  const result = { expectedSha: '', usageJsonStdin: false, observedAt: null };
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (seen.has(flag)) throw new Error('Invalid preflight arguments.');
    seen.add(flag);
    if (flag === '--usage-json-stdin') result.usageJsonStdin = true;
    else if (flag === '--source-sha') result.expectedSha = args[++index];
    else if (flag === '--observed-at') result.observedAt = args[++index];
    else throw new Error('Invalid preflight arguments.');
  }
  if (!isSha(result.expectedSha) || (result.usageJsonStdin !== (result.observedAt !== null))
    || (result.observedAt !== null && !timestamp(result.observedAt))) throw new Error('Invalid preflight arguments.');
  result.expectedSha = result.expectedSha.toLowerCase();
  return result;
}

export function readUsageInput(stream, { maxBytes = 65_536, timeoutMs = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      stream.off('close', onClose);
      stream.pause();
      if (error) stream.destroy();
      if (error) reject(new Error('Invalid or unavailable usage JSON input.'));
      else resolve(value);
    };
    const onData = chunk => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > maxBytes) return finish(true);
      chunks.push(bytes);
    };
    const onEnd = () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!isRecord(value)) return finish(true);
        finish(false, value);
      } catch { finish(true); }
    };
    const onError = () => finish(true);
    const onClose = () => finish(true);
    timer = setTimeout(() => finish(true), timeoutMs);
    stream.on('data', onData);
    stream.once('end', onEnd);
    stream.once('error', onError);
    stream.once('close', onClose);
    stream.resume();
  });
}

function localGit(args) {
  const environment = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP']) {
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  }
  return execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, maxBuffer: 65_536,
    stdio: ['ignore', 'pipe', 'pipe'], shell: false,
    env: { ...environment, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : os.devNull }
  }).trim();
}

export function readLocalGitState(git = localGit) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    actualSha: git(['rev-parse', 'HEAD']),
    clean: git(['status', '--porcelain', '--untracked-files=normal']) === '',
    onMain: branch === 'HEAD' ? null : branch === 'main'
  };
}

async function inspectLocalSource(expectedSha) {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'player-app/app.json'), 'utf8')).expo;
  const eas = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'player-app/eas.json'), 'utf8'));
  const installedTool = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'node_modules/eas-cli/package.json'), 'utf8'));
  const { validateProductionEnvironment } = require('../player-app/release-config.cjs');
  const easRequire = createRequire(path.join(repositoryRoot, 'node_modules/eas-cli/package.json'));
  const { EasJsonAccessor, EasJsonUtils, Platform } = easRequire('@expo/eas-json');
  let profileValid = false;
  try {
    const accessor = EasJsonAccessor.fromProjectPath(path.join(repositoryRoot, 'player-app'));
    await accessor.readAsync();
    const profile = await EasJsonUtils.getBuildProfileAsync(accessor, Platform.IOS, 'production');
    validateProductionEnvironment(profile.env || {});
    profileValid = eas.cli?.requireCommit === true && eas.cli?.appVersionSource === 'remote'
      && eas.cli?.version === rootPackage.devDependencies?.['eas-cli']
      && profile.distribution === 'store' && profile.simulator === false
      && profile.autoIncrement === true && profile.developmentClient !== true
      && profile.config === undefined && profile.node === rootPackage.engines?.node;
  } catch { /* Only a static profile-invalid code is exposed. */ }
  return {
    expectedSha, ...readLocalGitState(),
    toolVersion: installedTool.version, expectedToolVersion: rootPackage.devDependencies?.['eas-cli'],
    profileValid, expectedAccount: app?.owner
  };
}

export async function runCli(args = process.argv.slice(2), stdin = process.stdin, {
  inspect = inspectLocalSource,
  writeOut = value => process.stdout.write(value),
  writeError = value => process.stderr.write(value),
  now = () => new Date().toISOString()
} = {}) {
  try {
    const options = parseArguments(args);
    const usage = options.usageJsonStdin ? await readUsageInput(stdin) : undefined;
    const local = await inspect(options.expectedSha);
    const report = createPreflight({ ...local, usage, observedAt: options.observedAt, now: now() });
    writeOut(JSON.stringify(report, null, 2) + '\n');
    return report.exitCode;
  } catch {
    writeError('Player build preflight stopped: invalid input or unavailable local checks. No build or submission was started.\n');
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await runCli();
