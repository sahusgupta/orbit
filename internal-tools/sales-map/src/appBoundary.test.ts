import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceDirectory = fileURLToPath(new URL('.', import.meta.url));
const collectProductionFiles = (directory: string): string[] => readdirSync(
  directory,
  { withFileTypes: true }
).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return collectProductionFiles(path);
  return /\.(?:css|ts|tsx)$/.test(entry.name) && !entry.name.includes('.test.') ? [path] : [];
});
const sourceFiles = [
  ...collectProductionFiles(sourceDirectory),
  fileURLToPath(new URL('../vite.config.ts', import.meta.url))
];
const orbitCompositionFiles = [
  '../../../electron/main.cjs',
  '../../../src/components/AppShell.tsx',
  '../../../src/domain/types.ts',
  '../../../src/main.tsx',
  '../../../src/styles.css'
].map((relativePath) => fileURLToPath(new URL(relativePath, import.meta.url)));
const repositoryPackagePath = fileURLToPath(new URL('../../../package.json', import.meta.url));
const vercelIgnorePath = fileURLToPath(new URL('../../../.vercelignore', import.meta.url));
const appHtmlPath = fileURLToPath(new URL('../index.html', import.meta.url));

describe('standalone internal-tool boundary', () => {
  it('does not import Orbit runtime code or use external and persistent browser services', () => {
    const source = sourceFiles.map((path) => readFileSync(path, 'utf8')).join('\n');

    expect(source).not.toMatch(/(?:\.\.\/){2,}(?:apps|electron|player-app|player-web|src)\//);
    expect(source).not.toMatch(/electron|firebase|orbitSync|tableManagerDesktop/i);
    expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(readFileSync(appHtmlPath, 'utf8')).not.toMatch(
      /<(?:img|link|script)\b[^>]*(?:href|src)=["']https?:/i
    );
  });

  it('stays outside Orbit composition, packaging, and hosted-site inputs', () => {
    const orbitComposition = orbitCompositionFiles
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const repositoryPackage = JSON.parse(readFileSync(repositoryPackagePath, 'utf8')) as {
      build?: { files?: string[] };
    };
    const packagedFiles = repositoryPackage.build?.files ?? [];

    expect(orbitComposition).not.toMatch(/SalesMap|sales-map|Sales Map/);
    expect(packagedFiles.some((path) => path.includes('internal-tools'))).toBe(false);
    expect(readFileSync(vercelIgnorePath, 'utf8')).toMatch(/^internal-tools$/m);
  });
});
