const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const playerRoot = path.resolve(__dirname, '..');
const pinnedEasCli = require.resolve('eas-cli/bin/run', { paths: [repositoryRoot] });
const expectedApp = require('../app.json').expo;

function readOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : '';
}

function run(arguments_ = process.argv.slice(2), spawn = spawnSync) {
  const buildId = readOption(arguments_, '--build-id');
  const sourceSha = readOption(arguments_, '--source-sha');
  const confirmation = readOption(arguments_, '--confirm');

  if (!/^[A-Za-z0-9_-]{8,100}$/.test(buildId)) {
    throw new Error('Pass the reviewed EAS build identifier with --build-id. The latest build is never selected implicitly.');
  }
  if (!/^[0-9a-f]{40}$/i.test(sourceSha)) {
    throw new Error('Pass the exact 40-character pushed source commit with --source-sha.');
  }
  if (confirmation !== 'UPLOAD_EXACT_TESTFLIGHT_BUILD') {
    throw new Error('Pass --confirm UPLOAD_EXACT_TESTFLIGHT_BUILD only after the recorded SHA, CI, and candidate gates pass.');
  }

  const currentSha = spawn('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (currentSha.status !== 0) throw new Error('Unable to read the current Git commit.');
  if (currentSha.stdout.trim().toLowerCase() !== sourceSha.toLowerCase()) {
    throw new Error('The supplied source SHA does not match the current checkout.');
  }

  const buildView = spawn(
    process.execPath,
    [pinnedEasCli, 'build:view', buildId, '--json', '--non-interactive'],
    { cwd: playerRoot, encoding: 'utf8', shell: false }
  );
  if (buildView.error) throw buildView.error;
  if (buildView.status !== 0) throw new Error('Unable to verify the selected EAS build. Authenticate EAS and confirm the exact build ID.');
  let selectedBuild;
  try {
    selectedBuild = JSON.parse(buildView.stdout);
  } catch {
    throw new Error('EAS returned an unreadable build record; submission stopped.');
  }
  if (selectedBuild.id !== buildId) throw new Error('EAS returned a different build than the requested build ID.');
  if (
    selectedBuild.app?.id !== expectedApp.extra?.eas?.projectId
    || selectedBuild.app?.slug !== expectedApp.slug
    || selectedBuild.app?.ownerAccount?.name !== expectedApp.owner
  ) {
    throw new Error('The selected EAS build does not belong to the configured Orbit Player project identity.');
  }
  if (typeof selectedBuild.gitCommitHash !== 'string' || selectedBuild.gitCommitHash.toLowerCase() !== sourceSha.toLowerCase()) {
    throw new Error('The selected EAS build source commit does not match --source-sha.');
  }
  if (selectedBuild.platform !== 'IOS') throw new Error('The selected EAS build is not an iOS build.');
  if (selectedBuild.status !== 'FINISHED') throw new Error('The selected EAS build is not a finished candidate.');
  if (selectedBuild.buildProfile !== 'production' || String(selectedBuild.distribution || '').toUpperCase() !== 'STORE') {
    throw new Error('The selected EAS build is not a production store candidate.');
  }
  if (selectedBuild.isForIosSimulator !== false) throw new Error('The selected EAS build is not a physical-device candidate.');
  if (selectedBuild.appIdentifier !== expectedApp.ios?.bundleIdentifier || selectedBuild.appVersion !== expectedApp.version) {
    throw new Error('The selected EAS build identity or marketing version does not match the reviewed release.');
  }
  if (!/^[1-9]\d*$/.test(String(selectedBuild.appBuildVersion || ''))) {
    throw new Error('The selected EAS build does not have a valid positive iOS build number.');
  }

  const result = spawn(
    process.execPath,
    [pinnedEasCli, 'submit', '--platform', 'ios', '--profile', 'production', '--id', buildId],
    { cwd: playerRoot, stdio: 'inherit', shell: false }
  );
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (require.main === module) process.exitCode = run();

module.exports = { pinnedEasCli, run };
