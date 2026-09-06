'use strict';

const { spawnSync } = require('node:child_process');

const EXPECTED_NPM_VERSION = '10.9.2';

function npmInvocation(arguments_, platform, commandInterpreter) {
  return platform === 'win32'
    ? { command: commandInterpreter, arguments_: ['/d', '/s', '/c', `npm ${arguments_.join(' ')}`] }
    : { command: 'npm', arguments_ };
}

function pinEasNpm({
  platform = process.platform,
  commandInterpreter = process.env.ComSpec || 'cmd.exe',
  run = spawnSync,
  logger = console
} = {}) {
  const runNpm = (arguments_, options) => {
    const invocation = npmInvocation(arguments_, platform, commandInterpreter);
    return run(invocation.command, invocation.arguments_, options);
  };
  const installation = runNpm(
    ['install', '--global', `npm@${EXPECTED_NPM_VERSION}`, '--no-audit', '--no-fund'],
    { stdio: 'inherit', windowsHide: true }
  );

  if (installation.error || installation.status !== 0) {
    logger.error(`Unable to install the required EAS npm ${EXPECTED_NPM_VERSION} toolchain.`);
    return Number.isInteger(installation.status) && installation.status > 0 ? installation.status : 1;
  }

  const versionCheck = runNpm(['--version'], {
    encoding: 'utf8',
    windowsHide: true
  });
  const installedVersion = typeof versionCheck.stdout === 'string' ? versionCheck.stdout.trim() : '';

  if (versionCheck.error || versionCheck.status !== 0 || installedVersion !== EXPECTED_NPM_VERSION) {
    logger.error(`EAS npm version verification failed; expected ${EXPECTED_NPM_VERSION}.`);
    return 1;
  }

  logger.log(`EAS npm ${EXPECTED_NPM_VERSION} is ready.`);
  return 0;
}

if (require.main === module) {
  process.exitCode = pinEasNpm();
}

module.exports = { EXPECTED_NPM_VERSION, pinEasNpm };
