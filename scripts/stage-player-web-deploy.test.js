import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('Player Web deployment staging', () => {
  it('creates a self-contained app without build output or dependencies', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'orbit-player-web-stage-test-'));
    const outputRoot = path.join(temporaryRoot, 'artifact');

    try {
      execFileSync(process.execPath, [path.resolve('scripts/stage-player-web-deploy.mjs'), outputRoot]);

      const tsconfig = JSON.parse(readFileSync(path.join(outputRoot, 'tsconfig.json'), 'utf8'));
      const nextConfig = readFileSync(path.join(outputRoot, 'next.config.ts'), 'utf8');
      const vercelConfig = JSON.parse(readFileSync(path.join(outputRoot, 'vercel.json'), 'utf8'));
      expect(tsconfig.compilerOptions.paths['@orbit/player-domain/*']).toEqual([
        './.shared/player-app/src/domain/*'
      ]);
      expect(tsconfig.compilerOptions.paths['@orbit/player-requests']).toEqual([
        './.shared/player-app/src/data/playerRequests.ts'
      ]);
      expect(nextConfig).toContain('const repositoryRoot = process.cwd();');
      expect(vercelConfig).toEqual(expect.objectContaining({
        framework: 'nextjs',
        installCommand: 'npm ci',
        buildCommand: 'npm run build'
      }));
      expect(vercelConfig).not.toHaveProperty('outputDirectory');
      expect(existsSync(path.join(outputRoot, '.shared', 'player-app', 'src', 'domain', 'membershipQr.ts'))).toBe(true);
      expect(existsSync(path.join(outputRoot, '.shared', 'player-app', 'src', 'data', 'playerRequests.ts'))).toBe(true);
      expect(existsSync(path.join(outputRoot, 'node_modules'))).toBe(false);
      expect(existsSync(path.join(outputRoot, '.next'))).toBe(false);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
