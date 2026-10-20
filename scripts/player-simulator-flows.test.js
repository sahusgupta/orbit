import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { loadAll } = require('js-yaml');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSource = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
const readFlow = (name) => loadAll(readSource(`player-app/.maestro/${name}.yaml`));
const commandIndex = (commands, command, start = 0) => commands.findIndex((value, index) => index >= start
  && JSON.stringify(value) === JSON.stringify(command));
function expectOrdered(commands, expected) {
  let after = 0;
  for (const command of expected) {
    const index = commandIndex(commands, command, after);
    expect(index, `Missing ordered command ${JSON.stringify(command)}`).toBeGreaterThanOrEqual(after);
    after = index + 1;
  }
}

describe('isolated native Player smoke contracts', () => {
  it('dismisses each keyboard through the scroll margin without losing input or bypassing enabled controls', () => {
    const [, commands] = readFlow('local-profile');
    for (const value of ['Release Reviewer', 'release.qa@example.invalid']) {
      const inputIndex = commandIndex(commands, { inputText: value });
      expect(inputIndex).toBeGreaterThanOrEqual(0);
      expect(commands.slice(inputIndex, inputIndex + 9)).toEqual([
        { inputText: value },
        { assertVisible: { id: 'delete' } },
        { swipe: { start: '5%, 35%', end: '5%, 20%', duration: 400 } },
        { assertNotVisible: { id: 'delete' } },
        { assertNotVisible: { id: 'space' } },
        { assertVisible: value },
        { scrollUntilVisible: { element: 'Continue', direction: 'DOWN' } },
        { assertVisible: { text: 'Continue', enabled: true } },
        { tapOn: 'Continue' }
      ]);
    }
    expect(commands).not.toContain('hideKeyboard');
    expect(JSON.stringify(commands)).not.toMatch(/"(?:optional|continueOnFailure)":true/);
  });

  it('requires the adult declaration before opening account credentials on a denied-permissions fresh install', () => {
    const [metadata, commands] = readFlow('local-profile');
    expect(metadata.appId).toBe('com.caminuslabs.orbit');
    expect(commands[0]).toEqual({ launchApp: { clearState: true, permissions: { all: 'deny' } } });
    expectOrdered(commands, [
      { inputText: 'Release Reviewer' },
      { inputText: 'release.qa@example.invalid' },
      { assertVisible: { text: 'Continue to account', enabled: false } },
      { tapOn: 'I confirm that I am 18 or older' },
      { assertVisible: { text: 'Continue to account', enabled: true } },
      { tapOn: 'Continue to account' },
      { assertVisible: 'Create your account' },
      { assertVisible: 'Account password or passphrase' },
      { assertVisible: { text: 'Create account / sign in', enabled: false } }
    ]);
  });

  it('retains the draft in the background and returns to account choices after cold launch without authenticating', () => {
    const [, commands] = readFlow('local-profile');
    expectOrdered(commands, [
      { pressKey: 'Home' },
      { launchApp: { stopApp: false } },
      { assertVisible: 'Create your account' },
      { assertVisible: 'release.qa@example.invalid' },
      { assertNotVisible: 'Account connected' },
      'stopApp',
      'launchApp',
      { extendedWaitUntil: { visible: 'Find your next game', timeout: 30000 } },
      { assertVisible: 'Create account' },
      { assertVisible: 'Try demo account' },
      { assertNotVisible: 'Release Reviewer' },
      { assertNotVisible: 'Account connected' }
    ]);
  });

  it('offers account and demo choices and never submits credentials or invokes identity and account mutations', () => {
    const [, commands] = readFlow('local-profile');
    expectOrdered(commands, [
      { extendedWaitUntil: { visible: 'Find your next game', timeout: 30000 } },
      { assertVisible: 'Create account' },
      { assertVisible: 'Try demo account' },
      { assertVisible: 'Already have an account? Sign in' },
      { tapOn: 'Create account' },
      { assertVisible: 'release.qa@example.invalid' },
      { assertNotVisible: 'Account connected' }
    ]);
    const taps = commands.filter((command) => typeof command === 'object' && 'tapOn' in command).map((command) => command.tapOn);
    expect(taps).not.toContain('Create account / sign in');
    expect(taps.join('\n')).not.toMatch(/Forgot password|Delete|Identity|Sign in or create account/);
  });

  it('keeps optional demo Match entirely fictional with denied permissions and button-equivalent decisions', () => {
    const [metadata, commands] = readFlow('local-demo-match');
    expect(metadata.appId).toBe('com.caminuslabs.orbit');
    expect(commands[0]).toEqual({ launchApp: { clearState: true, permissions: { all: 'deny' } } });
    expectOrdered(commands, [
      { tapOn: 'Try demo account' },
      { extendedWaitUntil: { visible: 'Hi, Demo', timeout: 30000 } },
      { tapOn: 'Find games' },
      { assertVisible: 'Saved games, 0' },
      { tapOn: 'Save .*' },
      { tapOn: 'Saved games, 1' },
      { tapOn: 'Remove saved .*' },
      { assertVisible: 'No saved games yet' },
      { assertVisible: 'Saved games, 0' },
      { tapOn: 'Discover games' },
      { tapOn: 'Pass .*' },
      { assertVisible: { text: 'Undo last swipe', enabled: true } },
      { tapOn: 'Undo last swipe' },
      { assertVisible: { text: 'Undo last swipe', enabled: false } },
      { tapOn: 'Profile' },
      { tapOn: 'Exit demo' },
      { assertVisible: 'Create account' },
      { assertNotVisible: 'Demo Player' }
    ]);
    const taps = commands.filter((command) => typeof command === 'object' && 'tapOn' in command).map((command) => command.tapOn);
    expect(taps).not.toContain('Map');
    expect(taps.join('\n')).not.toMatch(/Directions|Request|Check.in|Sign.in|Identity/);
  });

  it('runs the optional flow only through the disposable blocked-host harness without changing the mandatory flow', () => {
    const runner = readSource('scripts/run-player-simulator-qa.mjs');
    expect(runner).toContain("process.platform, 'darwin'");
    expect(runner).toContain("process.env.GITHUB_ACTIONS, 'true'");
    expect(runner).toContain("const includeDemoMatch = demoQaFlag === '1'");
    expect(runner).toContain("demoQaFlag === undefined || demoQaFlag === '0' || demoQaFlag === '1'");
    expect(runner).toContain("if (includeDemoMatch) {");
    expect(runner).toContain("path.join(output, 'demo-match')");
    expect(runner).toContain("path.join(playerRoot, '.maestro', 'local-demo-match.yaml')");
    expect(runner.match(/path\.join\(playerRoot, '\.maestro', 'local-profile\.yaml'\)/g)).toHaveLength(2);
    expect(runner).toMatch(/await withBlockedPlayerHosts\([\s\S]*allResolveToLoopback: true,[\s\S]*await runDeviceFlows\(\);/);
    expect(runner).not.toMatch(/APP_CHECK_DEBUG|FIREBASE_AUTH_EMULATOR_HOST/);
  });
});
