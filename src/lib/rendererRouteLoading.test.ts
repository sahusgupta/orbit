import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');
const floorViewSource = readFileSync(fileURLToPath(new URL('../components/FloorView.tsx', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');
const loadingStyles = readFileSync(fileURLToPath(new URL('../styles/190-accessibility.css', import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const deferredRoutes = [
  'BuilderView',
  'KpisView',
  'ProfilesView',
  'SettingsView',
  'SignalsView',
  'SummaryView',
  'TableView',
  'TournamentsView',
  'TournamentTvView'
] as const;

describe('management route loading boundary', () => {
  it('keeps the default floor synchronous and defers every non-default route behind Suspense', () => {
    expect(mainSource).toContain("import FloorView from './components/FloorView';");
    expect(mainSource).toContain('{withRouteLoadingBoundary(content)}');
    expect(mainSource).toContain('withRouteLoadingBoundary(\n          <TournamentTvView');
    expect(mainSource).toContain("          'tournament-tv'\n        )");
    expect(mainSource).toContain('return withRouteLoadingBoundary(\n      <TableView');
    expect(mainSource).toContain("      'table-view'\n    );");
    deferredRoutes.forEach((component) => {
      expect(mainSource).toContain(
        `const ${component} = React.lazy(() => import('./components/${component}'));`
      );
      expect(mainSource).not.toMatch(new RegExp(`import\\s+${component}\\s+from`));
    });
  });

  it('defers mutually exclusive floor representations inside the synchronous floor route', () => {
    expect(floorViewSource).toContain("const FloorRoomMap = lazy(() => import('./FloorRoomMap'));");
    expect(floorViewSource).toContain("const FloorClassicOverview = lazy(() => import('./FloorClassicOverview'));");
    expect(floorViewSource).toContain("const PokerTable = lazy(() => import('./PokerTable'));");
    expect(floorViewSource).toContain('aria-label="Loading floor layout"');
    expect(floorViewSource).not.toMatch(/import\s+FloorRoomMap(?:,|\s+from)/);
    expect(floorViewSource).not.toMatch(/import\s+FloorClassicOverview\s+from/);
    expect(floorViewSource).not.toMatch(/import\s+PokerTable(?:,|\s+from)/);
  });

  it('defers the modal-only buy-in ledger without deferring the default floor', () => {
    expect(mainSource).toContain(
      "const TableBuyInLedger = React.lazy(() => import('./features/floor/TableBuyInLedger'));"
    );
    expect(mainSource).not.toMatch(/import\s+TableBuyInLedger\s+from/);
    expect(mainSource).toContain(
      '<React.Suspense fallback={<div className="cash-ledger-empty" aria-busy="true">Loading ledger...</div>}>'
    );
  });

  it('uses a canvas-matched, theme-aware gradient for route skeletons', () => {
    const skeletonRule = loadingStyles.match(/\.route-skeleton span \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(skeletonRule).toContain('linear-gradient');
    expect(skeletonRule).toContain('var(--canvas)');
    expect(skeletonRule).toContain('var(--state-loading)');
    expect(skeletonRule).not.toContain('--surface-soft');
  });

  it('uses the Tournament TV background for its full-screen loading skeleton', () => {
    const tvContainerRule = loadingStyles.match(/\.route-skeleton-tournament-tv \{[\s\S]*?\n\}/)?.[0] ?? '';
    const tvSkeletonRule = loadingStyles.match(/\.route-skeleton-tournament-tv span \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(tvContainerRule).toContain('background: #070b15');
    expect(tvContainerRule).toContain('min-height: 100vh');
    expect(tvSkeletonRule).toContain('linear-gradient(100deg, #070b15, #111827, #070b15)');
  });

  it('uses the immersive table background for its full-screen loading skeleton', () => {
    const tableContainerRule = loadingStyles.match(/\.route-skeleton-table-view \{[\s\S]*?\n\}/)?.[0] ?? '';
    const tableSkeletonRule = loadingStyles.match(/\.route-skeleton-table-view span \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(tableContainerRule).toContain('background: #080d13');
    expect(tableContainerRule).toContain('min-height: 100vh');
    expect(tableSkeletonRule).toContain('linear-gradient(100deg, #080d13, #0e151e, #080d13)');
  });
});
