import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createBundledAuditFixture, reviewBundledRuntimeAdvisories } from './bundled-runtime-advisory-constraints.mjs';
import { inspectBundledRuntimeArtifact } from './bundled-runtime-artifact-proof.mjs';

function publicNpmEnvironment(directory) {
  const names = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
  const environment = Object.fromEntries(names.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
  const user = path.join(directory, 'user.npmrc');
  const global = path.join(directory, 'global.npmrc');
  fs.writeFileSync(user, 'registry=https://registry.npmjs.org\n', { flag: 'wx' });
  fs.writeFileSync(global, '', { flag: 'wx' });
  return { ...environment, CI: '1', TZ: 'UTC',
    NPM_CONFIG_USERCONFIG: user, NPM_CONFIG_GLOBALCONFIG: global,
    NPM_CONFIG_CACHE: path.join(directory, 'npm-cache'), NPM_CONFIG_UPDATE_NOTIFIER: 'false' };
}

function npmJson(directory, args, environment, audit = false) {
  // All arguments below are fixed audit/list flags. Paths enter through cwd/env,
  // never command text; no shell text comes from registry responses or config.
  const executable = process.platform === 'win32' ? (environment.ComSpec || 'cmd.exe') : 'npm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`] : args;
  const result = spawnSync(executable, commandArgs, { cwd: directory, env: environment,
    encoding: 'utf8', windowsHide: true, timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status === null || result.status > (audit ? 1 : 0)) throw new Error('Bundled runtime npm inspection failed.');
  let report;
  try { report = JSON.parse(result.stdout); } catch { throw new Error('Bundled runtime npm inspection returned invalid JSON.'); }
  if (!report || typeof report !== 'object' || Array.isArray(report) || report.error) throw new Error('Bundled runtime npm inspection returned an error.');
  return report;
}

export function productionPackagesFromTree(tree, manifest) {
  const packages = [];
  let visited = 0;
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
  const packageName = value => typeof value === 'string' && value.length <= 214
    && /^(?:@[a-z0-9_][a-z0-9._-]*\/)?[a-z0-9_][a-z0-9._-]*$/i.test(value) && value !== 'node_modules';
  if (!isRecord(manifest) || typeof manifest.name !== 'string' || !manifest.name || !version(manifest.version)
    || !isRecord(tree) || tree.name !== manifest.name || tree.version !== manifest.version
    || !isRecord(tree.dependencies)) throw new Error('Production inventory root identity or dependency evidence is missing.');
  if (manifest.dependencies !== undefined && !isRecord(manifest.dependencies)
    || manifest.optionalDependencies !== undefined && !isRecord(manifest.optionalDependencies)) throw new Error('Invalid declared production dependencies.');
  const optional = new Set(Object.keys(manifest.optionalDependencies || {}));
  for (const name of Object.keys(manifest.dependencies || {})) {
    if (!optional.has(name) && !Object.hasOwn(tree.dependencies, name)) throw new Error('Declared production dependency is absent from the inventory.');
  }
  const inspect = (record, depth) => {
    if (!isRecord(record) || depth > 200 || ++visited > 50_000) throw new Error('Invalid production dependency tree.');
    if (record.problems !== undefined && !Array.isArray(record.problems)) throw new Error('Invalid production dependency problems.');
    if (record.problems?.length) throw new Error('Production dependency tree has unresolved problems.');
    for (const metadata of ['optionalDependencies', 'peerDependencies', 'peerDependenciesMeta']) {
      if (record[metadata] !== undefined && !isRecord(record[metadata])) throw new Error('Invalid optional production dependency evidence.');
    }
    if (record.dependencies === undefined) return;
    if (!record.dependencies || typeof record.dependencies !== 'object' || Array.isArray(record.dependencies)) throw new Error('Invalid production dependency children.');
    for (const [name, child] of Object.entries(record.dependencies)) {
      // npm ls --long represents an uninstalled platform dependency or optional
      // peer as exactly {}. Accept that shape only with its explicit declaration;
      // other empty/incomplete nodes still block the artifact boundary.
      const declaredOptional = typeof record.optionalDependencies?.[name] === 'string' && record.optionalDependencies[name].trim()
        || typeof record.peerDependencies?.[name] === 'string' && record.peerDependencies[name].trim()
          && isRecord(record.peerDependenciesMeta?.[name]) && record.peerDependenciesMeta[name].optional === true;
      if (packageName(name) && isRecord(child) && Object.keys(child).length === 0 && declaredOptional) continue;
      if (!packageName(name) || !isRecord(child) || !version(child.version)
        || child.name !== undefined && child.name !== name
        || child.missing || child.invalid || child.extraneous || child.link || child.error) throw new Error('Incomplete or aliased production dependency node.');
      packages.push({ name, version: child.version });
      inspect(child, depth + 1);
    }
  };
  inspect(tree, 0);
  return packages;
}

export async function auditBundledRuntimeDependencies(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config/bundled-runtime-audit.json'), 'utf8'));
  if (!Array.isArray(config.dependencies) || config.dependencies.length !== 1 || config.dependencies[0].packageName !== 'exceljs') {
    throw new Error('Bundled runtime inventory requires review.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const output = path.join(root, 'out');
  fs.mkdirSync(output, { recursive: true });
  if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Bundled runtime evidence directory must not be linked.');
  const directory = fs.mkdtempSync(path.join(output, 'bundled-runtime-audit-'));
  const environment = publicNpmEnvironment(directory);
  const productionTree = npmJson(root, ['ls', '--all', '--omit=dev', '--json', '--long'], environment);
  fs.writeFileSync(path.join(directory, 'production-tree.json'), JSON.stringify(productionTree, null, 2) + '\n', { flag: 'wx' });
  const productionPackages = productionPackagesFromTree(productionTree, manifest);
  const results = [];
  for (const review of config.dependencies) {
    if (typeof review.review !== 'string' || !/^docs\/agent\/reviews\/[a-z0-9-]+\.md$/.test(review.review)
      || !fs.existsSync(path.join(root, review.review))) throw new Error('Bundled runtime review record is missing.');
    const fixture = createBundledAuditFixture(manifest, lock, review.packageName);
    const proof = await inspectBundledRuntimeArtifact(root, review, productionPackages, directory);
    if (!proof.valid) throw new Error(`Bundled runtime artifact boundary failed:\n- ${proof.failures.join('\n- ')}`);
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify(fixture.manifest, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'package-lock.json'), JSON.stringify(fixture.lock, null, 2) + '\n', { flag: 'wx' });
    const report = npmJson(directory, ['audit', '--package-lock-only', '--ignore-scripts', '--json', '--registry=https://registry.npmjs.org'], environment, true);
    const reviewed = reviewBundledRuntimeAdvisories(report, fixture.lock, review, proof);
    fs.writeFileSync(path.join(directory, 'audit.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ packageName: review.packageName,
      version: review.version, proof, ...reviewed }, null, 2) + '\n', { flag: 'wx' });
    if (reviewed.failures.length) throw new Error(`Bundled runtime advisory gate failed:\n- ${reviewed.failures.join('\n- ')}`);
    console.log(`renderer-runtime: ${review.packageName}@${review.version} browser artifact verified; ${reviewed.dispositions.length} Node-only aggregate findings remain visible in the scoped audit evidence.`);
    for (const disposition of reviewed.dispositions) {
      const origins = [...new Set(disposition.origins.map(origin => origin.url))].join(', ');
      console.log(`renderer-runtime: ${disposition.name}: excluded from shipped artifact (${origins}); ${disposition.nodes.map(node => `${node.path}@${node.version}`).join(', ')}.`);
    }
    results.push({ packageName: review.packageName, version: review.version, proof, dispositions: reviewed.dispositions });
  }
  return results;
}
