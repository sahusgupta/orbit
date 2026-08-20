import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  getSalesMapDemoResetSignalPath,
  requestSalesMapDemoReset
} from './reset-sales-map-demo.mjs';

describe('sales-map demo reset signal', () => {
  it('updates only the ignored workspace signal and preserves neighboring data', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'orbit-sales-map-reset-'));

    try {
      const signalPath = await requestSalesMapDemoReset(workspaceRoot);
      const firstSignal = await readFile(signalPath, 'utf8');
      const siblingPath = path.join(workspaceRoot, '.orbit', 'unrelated-state.json');
      await writeFile(siblingPath, 'preserve me', 'utf8');

      await requestSalesMapDemoReset(workspaceRoot);

      expect(signalPath).toBe(getSalesMapDemoResetSignalPath(workspaceRoot));
      expect(await readFile(signalPath, 'utf8')).not.toBe(firstSignal);
      expect(await readFile(siblingPath, 'utf8')).toBe('preserve me');
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
