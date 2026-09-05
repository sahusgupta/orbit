import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { pinnedEasCli, run } = require('../player-app/scripts/submit-testflight.cjs');
const sourceSha = 'a'.repeat(40);
const buildId = 'build_12345678';
const projectId = 'bb2059b7-91b3-4a6b-a66e-d5618e794fd3';
const arguments_ = [
  '--build-id', buildId,
  '--source-sha', sourceSha,
  '--confirm', 'UPLOAD_EXACT_TESTFLIGHT_BUILD'
];

describe('exact TestFlight submission guard', () => {
  it('uses the repository-locked EAS CLI and submits only the verified build ID', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: `${sourceSha}\n` })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          id: buildId,
          gitCommitHash: sourceSha,
          platform: 'IOS',
          status: 'FINISHED',
          buildProfile: 'production',
          distribution: 'STORE',
          isForIosSimulator: false,
          appIdentifier: 'com.orbit.player',
          appVersion: '1.0.0',
          appBuildVersion: '7',
          app: { id: projectId, slug: 'tabletalk-player', ownerAccount: { name: 'saussy' } }
        })
      })
      .mockReturnValueOnce({ status: 0 });

    expect(run(arguments_, spawn)).toBe(0);
    expect(path.normalize(pinnedEasCli)).toContain(path.normalize('node_modules/eas-cli/bin/run'));
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [pinnedEasCli, 'build:view', buildId, '--json', '--non-interactive'],
      { cwd: expect.stringMatching(/[\\/]player-app$/), encoding: 'utf8', shell: false }
    );
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [pinnedEasCli, 'submit', '--platform', 'ios', '--profile', 'production', '--id', buildId],
      { cwd: expect.stringMatching(/[\\/]player-app$/), stdio: 'inherit', shell: false }
    );
  });

  it('stops before submission when EAS reports a different source commit', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: `${sourceSha}\n` })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          id: buildId,
          gitCommitHash: 'b'.repeat(40),
          platform: 'IOS',
          status: 'FINISHED',
          buildProfile: 'production',
          distribution: 'STORE',
          isForIosSimulator: false,
          appIdentifier: 'com.orbit.player',
          appVersion: '1.0.0',
          appBuildVersion: '7',
          app: { id: projectId, slug: 'tabletalk-player', ownerAccount: { name: 'saussy' } }
        })
      });

    expect(() => run(arguments_, spawn)).toThrow('does not match --source-sha');
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('rejects a finished iOS build from a different EAS project before submission', () => {
    const spawn = vi.fn()
      .mockReturnValueOnce({ status: 0, stdout: `${sourceSha}\n` })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          id: buildId,
          gitCommitHash: sourceSha,
          platform: 'IOS',
          status: 'FINISHED',
          buildProfile: 'production',
          distribution: 'STORE',
          isForIosSimulator: false,
          appIdentifier: 'com.orbit.player',
          appVersion: '1.0.0',
          appBuildVersion: '7',
          app: { id: 'different-project', slug: 'tabletalk-player', ownerAccount: { name: 'saussy' } }
        })
      });

    expect(() => run(arguments_, spawn)).toThrow('does not belong to the configured Orbit Player project identity');
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});
