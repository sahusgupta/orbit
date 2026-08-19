import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const floorUtilitiesCss = readFileSync(
  fileURLToPath(new URL('../styles/290-floor-utilities.css', import.meta.url)),
  'utf8'
);

describe('floor workspace layout contract', () => {
  it('styles Radix-portaled workspace content without requiring a Floor ancestor', () => {
    expect(floorUtilitiesCss).toContain('.floor-workspace-popup:not(.collapsed-panel)');
    expect(floorUtilitiesCss).not.toContain('.floor-view-shell .floor-workspace-popup:not(.collapsed-panel)');
  });

  it('keeps the workspace dock positioned over the room map instead of the viewport', () => {
    const dockRule = floorUtilitiesCss.match(/\.floor-workspace-dock\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(dockRule).toContain('position: absolute');
    expect(dockRule).not.toContain('position: fixed');
    expect(floorUtilitiesCss).toMatch(/\.floor-room-workspace\s*\{[^}]*position:\s*relative;/s);
  });

  it('accounts for the compact shell header without forcing tablet-height overflow', () => {
    expect(floorUtilitiesCss).toMatch(
      /@media \(min-width: 601px\) and \(max-width: 900px\)[\s\S]*?\.orbit-shell:has\(\.floor-view-shell\) \.orbit-shell-content,[\s\S]*?\.orbit-shell \.floor-view-shell\s*\{[^}]*min-height:\s*calc\(100dvh - 50px\);/
    );
  });
});
