import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetEntry = fileURLToPath(new URL('./styles.css', import.meta.url));
const originalCascadeSha256 = '622daa8f9ee606c7f8012c46a8ac4d61d12d94146374a86be35dfdb430db4951';
const localImportPattern = /^@import ['"](.+\.css)['"];\r?\n/gm;

function flattenLocalImports(path: string, ancestors: string[] = []): string {
  if (ancestors.includes(path)) {
    throw new Error(`Circular stylesheet import: ${[...ancestors, path].join(' -> ')}`);
  }

  const source = readFileSync(path, 'utf8');
  return source.replace(localImportPattern, (_statement, relativePath: string) =>
    flattenLocalImports(resolve(dirname(path), relativePath), [...ancestors, path])
  );
}

describe('management stylesheet cascade', () => {
  it('preserves the characterized ordered source cascade byte-for-byte', () => {
    const flattened = flattenLocalImports(stylesheetEntry);
    const digest = createHash('sha256').update(flattened).digest('hex');

    expect(digest).toBe(originalCascadeSha256);
  });
});
