import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyReviewFailures } from './dependency-review-constraints.mjs';
import { auditBundledRuntimeDependencies } from './audit-bundled-runtime-dependencies.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(repositoryRoot, 'config', 'dependency-audit-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
const reviewDeadline = Date.parse(`${policy.reviewBy}T23:59:59.999Z`);
if (!Number.isFinite(reviewDeadline) || Date.now() > reviewDeadline) {
  throw new Error(`Dependency advisory policy expired on ${policy.reviewBy}; review current reachability before continuing.`);
}

const scopes = [
  { name: 'root', prefix: undefined },
  { name: 'api', prefix: 'apps/api' },
  { name: 'player', prefix: 'player-app' },
  { name: 'web', prefix: 'player-web' }
];
const failures = [];

const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function readAuditReport(result, scope) {
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status) || result.signal !== null) {
    throw new Error(`npm audit did not complete with a valid status for ${scope}.`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned non-JSON output for ${scope}.`);
  }
  if (!isRecord(report)) throw new Error(`npm audit returned an invalid report for ${scope}.`);
  if (report.error !== undefined) throw new Error(`npm audit failed for ${scope}: ${report.error?.summary || report.error?.code || 'unknown error'}`);

  const counts = report.metadata?.vulnerabilities;
  if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)
    || !isRecord(report.metadata) || !isRecord(counts)
    || [...severities, 'total'].some(severity => !Number.isSafeInteger(counts[severity]) || counts[severity] < 0)) {
    throw new Error(`npm audit returned incomplete evidence for ${scope}.`);
  }
  const observed = Object.fromEntries(severities.map(severity => [severity, 0]));
  const entries = Object.entries(report.vulnerabilities);
  for (const [name, vulnerability] of entries) {
    if (!name || !isRecord(vulnerability) || vulnerability.name !== name || !severities.includes(vulnerability.severity)) {
      throw new Error(`npm audit returned an invalid vulnerability for ${scope}.`);
    }
    observed[vulnerability.severity] += 1;
  }
  if (entries.length !== counts.total || severities.some(severity => counts[severity] !== observed[severity])
    || severities.reduce((sum, severity) => sum + counts[severity], 0) !== counts.total
    || result.status === 1 && counts.total === 0) {
    throw new Error(`npm audit returned inconsistent evidence for ${scope}.`);
  }
  return report;
}

for (const scope of scopes) {
  const args = ['audit', '--omit=dev', '--json'];
  if (scope.prefix) args.push('--prefix', scope.prefix);
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npm ${args.join(' ')}`] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  const report = readAuditReport(result, scope.name);
  const vulnerabilities = Object.values(report.vulnerabilities);
  const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, scope.prefix || '', 'package-lock.json'), 'utf8'));
  failures.push(...dependencyReviewFailures(scope.name, vulnerabilities, policy.scopes?.[scope.name], lock));
  const allowed = new Set(policy.scopes?.[scope.name]?.allowed || []);
  for (const vulnerability of vulnerabilities) {
    const name = String(vulnerability.name || 'unknown');
    const severity = String(vulnerability.severity || 'unknown');
    if (severity === 'critical') {
      failures.push(`${scope.name}:${name} is critical and cannot be allowlisted.`);
    } else if (!allowed.has(name)) {
      failures.push(`${scope.name}:${name} (${severity}) is not in the reviewed policy.`);
    }
  }

  const observedNames = new Set(vulnerabilities.map((entry) => String(entry.name || 'unknown')));
  const resolvedPolicyEntries = [...allowed].filter((name) => !observedNames.has(name));
  const counts = report.metadata.vulnerabilities;
  const summary = ['critical', 'high', 'moderate', 'low']
    .map((severity) => `${severity}=${Number(counts[severity] || 0)}`)
    .join(' ');
  console.log(`${scope.name}: ${summary}; reviewed exceptions=${vulnerabilities.length}`);
  if (resolvedPolicyEntries.length) {
    console.log(`${scope.name}: upstream resolved ${resolvedPolicyEntries.join(', ')}; remove these entries at the next policy review.`);
  }
}

if (failures.length) {
  throw new Error(`Dependency advisory gate failed:\n- ${failures.join('\n- ')}`);
}

await auditBundledRuntimeDependencies(repositoryRoot);

console.log(`Dependency advisory reachability policy passed; next mandatory review: ${policy.reviewBy}.`);
