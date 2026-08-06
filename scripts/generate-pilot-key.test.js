import path from 'node:path';
import { describe, expect, it } from 'vitest';
import generator from './generate-pilot-key.cjs';

const { resolvePilotKeyOutputPath } = generator;

describe('pilot key output paths', () => {
  it('keeps the existing default filename for a new club key', () => {
    const outputPath = resolvePilotKeyOutputPath('C:\\keys', 'Example Club', '', () => false);
    expect(path.basename(outputPath)).toBe('example-club-pilot-key.json');
  });

  it('accepts a distinct JSON filename for a replacement key', () => {
    const outputPath = resolvePilotKeyOutputPath(
      'C:\\keys',
      'Example Club',
      'example-club-2026-08-05-pilot-key.json',
      () => false
    );
    expect(path.basename(outputPath)).toBe('example-club-2026-08-05-pilot-key.json');
  });

  it('rejects overwrites and paths outside the working directory', () => {
    expect(() => resolvePilotKeyOutputPath('C:\\keys', 'Example Club', '..\\key.json', () => false))
      .toThrow('plain JSON filename');
    expect(() => resolvePilotKeyOutputPath('C:\\keys', 'Example Club', 'existing.json', () => true))
      .toThrow('already exists');
  });
});
