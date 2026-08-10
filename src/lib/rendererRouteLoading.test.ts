import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8')
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

    deferredRoutes.forEach((component) => {
      expect(mainSource).toContain(
        `const ${component} = React.lazy(() => import('./components/${component}'));`
      );
      expect(mainSource).not.toMatch(new RegExp(`import\\s+${component}\\s+from`));
    });
  });
});
