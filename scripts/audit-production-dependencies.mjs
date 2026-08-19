import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (result.error) throw result.error;

  let report;
  try {
    report = JSON.parse(result.stdout || '{}');
  } catch {
    throw new Error(`npm audit returned non-JSON output for ${scope.name}.`);
  }
  if (report.error) throw new Error(`npm audit failed for ${scope.name}: ${report.error.summary || report.error.code || 'unknown error'}`);

  const vulnerabilities = Object.values(report.vulnerabilities || {});
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
  const counts = report.metadata?.vulnerabilities || {};
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

console.log(`Dependency advisory reachability policy passed; next mandatory review: ${policy.reviewBy}.`);
