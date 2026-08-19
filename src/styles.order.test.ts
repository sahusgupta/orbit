import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const stylesheetEntry = fileURLToPath(new URL('./styles.css', import.meta.url));
const normalizedCascadeSha256 = '1f7f1c9fac26f230aa9df0b220098bd944f359bfcde25029d982ea922199cc75';
const localImportPattern = /^@import ['"](.+\.css)['"];\r?\n/gm;

function flattenLocalImports(path: string, ancestors: string[] = []): string {
  if (ancestors.includes(path)) {
    throw new Error(`Circular stylesheet import: ${[...ancestors, path].join(' -> ')}`);
  }

  const source = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return source.replace(localImportPattern, (_statement, relativePath: string) =>
    flattenLocalImports(resolve(dirname(path), relativePath), [...ancestors, path])
  );
}

describe('management stylesheet cascade', () => {
  it('preserves the characterized ordered source cascade byte-for-byte', () => {
    const flattened = flattenLocalImports(stylesheetEntry);
    const digest = createHash('sha256').update(flattened).digest('hex');

    expect(digest).toBe(normalizedCascadeSha256);
  });
});
