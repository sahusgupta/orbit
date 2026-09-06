import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      expect(nextConfig).toContain('validateHostedPlayerWebEnvironment(process.env)');
      expect(existsSync(path.join(outputRoot, 'release-config.ts'))).toBe(true);
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

  it('excludes environment files, Git metadata, and generated evidence from a disposable source tree', () => {
    const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'orbit-player-web-safety-test-'));
    const sourceRoot = path.join(temporaryRoot, 'source');
    const outputRoot = path.join(temporaryRoot, 'artifact');
    const write = (relative, content = 'synthetic non-secret fixture') => {
      const target = path.join(sourceRoot, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
    };
    try {
      write('player-web/tsconfig.json', JSON.stringify({ compilerOptions: { paths: {} } }));
      write('player-web/next.config.ts', "import path from 'node:path';\nconst repositoryRoot = path.resolve(process.cwd(), '..');\n");
      write('player-app/src/domain/contract.ts');
      write('player-app/src/data/playerRequests.ts');
      for (const file of ['.env', '.env.production', '.git/config', 'test-results/recording.txt', 'coverage/index.html']) {
        write(`player-web/${file}`);
      }
      mkdirSync(path.join(sourceRoot, 'scripts'));
      cpSync(path.resolve('scripts/stage-player-web-deploy.mjs'), path.join(sourceRoot, 'scripts/stage-player-web-deploy.mjs'));
      execFileSync(process.execPath, [path.join(sourceRoot, 'scripts/stage-player-web-deploy.mjs'), outputRoot]);
      for (const file of ['.env', '.env.production', '.git', 'test-results', 'coverage']) {
        expect(existsSync(path.join(outputRoot, file)), file).toBe(false);
      }
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
