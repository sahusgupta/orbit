import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projects = ['apps/api', 'player-app', 'player-web'];
const failures = [];

for (const project of projects) {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, project, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, project, 'package-lock.json'), 'utf8'));
  const declaredDependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies
  };

  for (const [name, version] of Object.entries(declaredDependencies)) {
    if (name === 'table_manager' || (typeof version === 'string' && /^file:\.\.(?:[\\/]|$)/.test(version))) {
      failures.push(`${project}/package.json contains the parent dependency ${name}: ${version}.`);
    }
  }

  for (const [packagePath, metadata] of Object.entries(lock.packages || {})) {
    const resolution = typeof metadata?.resolved === 'string' ? metadata.resolved : '';
    if (
      packagePath === '..' ||
      packagePath === '../..' ||
      packagePath.endsWith('node_modules/table_manager') ||
      /^file:\.\.(?:[\\/]|$)/.test(resolution)
    ) {
      failures.push(`${project}/package-lock.json contains parent package entry ${packagePath || resolution}.`);
    }
  }

  const installedParent = path.join(repositoryRoot, project, 'node_modules', 'table_manager');
  if (fs.existsSync(installedParent)) failures.push(`${project}/node_modules contains the parent table_manager package.`);
}

if (failures.length) throw new Error(`Independent package verification failed:\n- ${failures.join('\n- ')}`);
console.log('Independent package verification passed: API, Player, and Player Web have no parent file dependency or installed table_manager copy.');
