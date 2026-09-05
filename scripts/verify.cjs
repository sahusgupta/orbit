const { spawnSync } = require('child_process');

const checks = [
  { name: 'Root TypeScript', script: 'typecheck' },
  { name: 'Player TypeScript', script: 'player:typecheck' },
  { name: 'Player release contract', script: 'player:release:verify' },
  { name: 'Player release artwork', script: 'player:assets:verify' },
  { name: 'Player Web TypeScript', script: 'web:typecheck' },
  { name: 'Player Web lint', script: 'web:lint' },
  { name: 'Player Web focused tests', script: 'web:test' },
  { name: 'Internal sales map TypeScript', script: 'sales-map:typecheck' },
  { name: 'Internal sales map tests', script: 'sales-map:test' },
  { name: 'Unit tests', script: 'test' },
  { name: 'Player Web production build', script: 'web:build' },
  { name: 'Internal sales map build', script: 'sales-map:build' },
  { name: 'Desktop renderer build', script: 'build' }
];

function runNpmScript(script) {
  if (process.platform === 'win32') {
    return spawnSync(
      process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `npm.cmd run ${script}`],
      { cwd: process.cwd(), stdio: 'inherit', windowsHide: true }
    );
  }

  return spawnSync('npm', ['run', script], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
}

const results = [];

for (const check of checks) {
  console.log(`\n=== ${check.name} ===`);
  const result = runNpmScript(check.script);
  const exitCode = result.error ? 1 : (result.status ?? 1);
  if (result.error) console.error(result.error.message);
  results.push({ ...check, exitCode });
}

console.log('\n=== Verification summary ===');
for (const result of results) {
  console.log(`${result.exitCode === 0 ? 'PASS' : 'FAIL'} ${result.name} (npm run ${result.script})`);
}

if (results.some((result) => result.exitCode !== 0)) process.exitCode = 1;
