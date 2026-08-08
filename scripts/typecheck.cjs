const { spawnSync } = require('child_process');

const checks = [
  { name: 'Renderer TypeScript', project: 'tsconfig.renderer.json' },
  { name: 'Root test TypeScript', project: 'tsconfig.test.json' },
  { name: 'Electron check-JS', project: 'tsconfig.electron.json' },
  { name: 'API check-JS', project: 'apps/api/tsconfig.json' }
];

const tscPath = require.resolve('typescript/bin/tsc');
const results = [];

for (const check of checks) {
  console.log(`\n=== ${check.name} ===`);
  const result = spawnSync(process.execPath, [tscPath, '--project', check.project, '--noEmit'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    windowsHide: true
  });
  const exitCode = result.error ? 1 : (result.status ?? 1);
  if (result.error) console.error(result.error.message);
  results.push({ ...check, exitCode });
}

console.log('\n=== Root TypeScript summary ===');
for (const result of results) {
  console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${result.name} (${result.project})`);
}

if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
