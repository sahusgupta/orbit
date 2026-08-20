import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const floorUtilitiesCss = readFileSync(
  fileURLToPath(new URL('../styles/290-floor-utilities.css', import.meta.url)),
  'utf8'
);
const floorRoomMapCss = readFileSync(
  fileURLToPath(new URL('../styles/270-floor-room-map.css', import.meta.url)),
  'utf8'
);
const operationalModalCss = readFileSync(
  fileURLToPath(new URL('../styles/121-premium-detail-compatibility.css', import.meta.url)),
  'utf8'
);
const seatPickerCss = readFileSync(
  fileURLToPath(new URL('../styles/21-floor-seat-picker.css', import.meta.url)),
  'utf8'
);

function getRuleZIndex(source: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = source.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  const value = rule?.[1].match(/z-index:\s*(\d+)/)?.[1];
  if (!value) throw new Error(`Missing z-index for ${selector}`);
  return Number(value);
}

describe('floor workspace layout contract', () => {
  it('keeps nested operational modals interactive above every floor workspace dialog layer', () => {
    const floorDialogLayers = [
      getRuleZIndex(floorUtilitiesCss, '.floor-workspace-backdrop'),
      getRuleZIndex(floorUtilitiesCss, '.floor-workspace-popup:not(.collapsed-panel)'),
      getRuleZIndex(floorRoomMapCss, '.floor-map-dialog-overlay'),
      getRuleZIndex(floorRoomMapCss, '.floor-map-dialog')
    ];
    const highestFloorDialogLayer = Math.max(...floorDialogLayers);
    const seatPickerRule = seatPickerCss.match(/\.seat-picker-backdrop\s*\{([^}]*)\}/)?.[1] ?? '';
    const cashModalRule = operationalModalCss.match(
      /\.cash-ledger-backdrop,\s*\.cash-out-backdrop\s*\{([^}]*)\}/
    )?.[1] ?? '';

    expect(getRuleZIndex(seatPickerCss, '.seat-picker-backdrop')).toBeGreaterThan(highestFloorDialogLayer);
    expect(getRuleZIndex(operationalModalCss, '.cash-out-backdrop')).toBeGreaterThan(highestFloorDialogLayer);
    expect(seatPickerRule).toContain('pointer-events: auto');
    expect(cashModalRule).toContain('pointer-events: auto');
  });

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

  it('lets the room workspace consume the remaining Floor shell above the mobile bottom nav', () => {
    const shellRule = floorUtilitiesCss.match(/\.orbit-shell \.floor-view-shell\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceRule = floorUtilitiesCss.match(/\.floor-room-workspace\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(shellRule).toContain('display: flex');
    expect(shellRule).toContain('flex-direction: column');
    expect(workspaceRule).toContain('flex: 1 1 auto');
    expect(floorUtilitiesCss).toMatch(
      /@media \(min-width: 601px\)\s*\{\s*\.orbit-shell \.floor-view-shell\s*\{[^}]*padding-bottom:\s*0;/s
    );
  });

  it('accounts for the compact shell header without forcing tablet-height overflow', () => {
    expect(floorUtilitiesCss).toMatch(
      /@media \(min-width: 601px\) and \(max-width: 900px\)[\s\S]*?\.orbit-shell:has\(\.floor-view-shell\) \.orbit-shell-content,[\s\S]*?\.orbit-shell \.floor-view-shell\s*\{[^}]*min-height:\s*calc\(100dvh - 50px\);/
    );
    expect(floorUtilitiesCss).toMatch(
      /@media \(min-width: 601px\) and \(max-width: 900px\)[\s\S]*?\.orbit-shell \.floor-view-shell\s*\{[^}]*height:\s*calc\(100dvh - 50px\);/
    );
    expect(floorUtilitiesCss).toMatch(
      /@media \(min-width: 601px\) and \(max-width: 900px\)[\s\S]*?\.floor-room-workspace\s*\{[^}]*min-height:\s*0;/
    );
  });
});
