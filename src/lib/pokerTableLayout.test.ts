import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tableViewCalmCss = readFileSync(
  fileURLToPath(new URL('../styles/280-table-view-calm.css', import.meta.url)),
  'utf8'
);

describe('PokerTable player-details layout', () => {
  it('keeps action forms inside a fixed, internally scrollable workspace', () => {
    const workspaceRule = tableViewCalmCss.match(
      /\.poker-seat-menu-workspace\.with-actions\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(workspaceRule).toMatch(/block-size:\s*clamp\(/);
    expect(workspaceRule).toContain('overflow-y: auto');
    expect(workspaceRule).toContain('overscroll-behavior: contain');
  });
});
