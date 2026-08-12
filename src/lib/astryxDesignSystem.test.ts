import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

function cssFiles(relativeDirectory: string) {
  const directory = resolve(repositoryRoot, relativeDirectory);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.css'))
    .map((entry) => resolve(directory, entry.name));
}

describe('Astryx design-system contract', () => {
  it('defines the cross-surface foundation roles', () => {
    const desktop = read('src/styles/00-foundation.css');
    const player = read('player-app/src/styles/playerTheme.ts');
    for (const token of [
      '--font-sans', '--font-weight-regular', '--type-heading-1', '--space-1', '--radius-control',
      '--elevation-overlay', '--motion-base', '--ease-standard', '--control-height-touch',
      '--icon-size-md', '--layout-wide', '--state-hover', '--state-selected', '--state-disabled',
      '--state-loading', '--state-success', '--state-warning', '--state-error'
    ]) expect(desktop).toContain(token);
    for (const role of ['typography', 'spacing', 'radii', 'elevation', 'motion', 'density', 'iconSizes', 'breakpoints', 'layout']) {
      expect(player).toContain(`export const ${role}`);
    }
  });

  it('uses only supported 400-700 font weights', () => {
    const files = [
      ...cssFiles('src/styles'),
      ...cssFiles('download-site'),
      ...cssFiles('apps/api/public')
    ];
    const unsupported = files.flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/font-weight:\s*(\d+)/g)]
      .filter((match) => !['400', '500', '600', '700'].includes(match[1]))
      .map((match) => `${file}:${match[1]}`));
    expect(unsupported).toEqual([]);
    expect(read('player-app/src/styles/sharedStyles.ts')).not.toMatch(/fontWeight:\s*'(?:800|900)'/);
  });

  it('keeps prohibited decorative patterns out of audited surfaces', () => {
    const productCss = cssFiles('src/styles').map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(productCss).not.toMatch(/backdrop-filter:\s*blur/i);
    expect(productCss).not.toMatch(/panel-rise|soft-flicker|viable-pulse|orbit-tv-blue-breathe/);
    for (const file of [
      'src/styles/90-dark-theme-base.css',
      'src/styles/110-table-view.css',
      'src/styles/121-premium-detail-compatibility.css',
      'src/styles/171-tournament-tv.css'
    ]) expect(read(file)).not.toContain('radial-gradient');
    expect(read('src/styles/10-shared-controls.css')).toContain('border-radius: var(--radius-control)');
  });

  it('preserves reduced motion and exposes player selection/disclosure state', () => {
    expect(read('src/styles/80-motion-responsive.css')).toContain('@media (prefers-reduced-motion: reduce)');
    const presentation = read('player-app/src/components/PlayerPresentation.tsx');
    expect(presentation).toContain('AccessibilityInfo.isReduceMotionEnabled()');
    expect(presentation).toContain('accessibilityState={{ selected: value === option.value }}');
    const clubHub = read('player-app/src/features/clubs/ClubHub.tsx');
    expect(clubHub.match(/accessibilityState=\{\{ expanded:/g)).toHaveLength(3);
    const details = read('player-app/src/features/discovery/DiscoveryGameDetails.tsx');
    expect(details.match(/accessibilityState=\{\{ expanded:/g)).toHaveLength(2);
  });

  it('keeps persistent labels, live status, and names for compact controls', () => {
    const management = read('src/main.tsx');
    expect(management).toContain('<label className="access-field">Login email');
    expect(management).toContain('<label className="access-field">Password or passphrase');
    const dashboard = read('apps/api/public/dashboard.html');
    expect(dashboard).toContain('<label class="sr-only" for="api-key">Dashboard password</label>');
    expect(dashboard).toContain('id="status" class="status" aria-live="polite"');
    const floor = read('src/components/FloorView.tsx');
    expect(floor).toContain('aria-label={tableExpanded ? \'Hide table\' : \'Show table\'}');
    expect(floor).toContain('title={playerSession.playerName}');
  });

  it('keeps served brand exports byte-identical to their canonical sources', () => {
    const pairs = [
      ['public/orbit-logo.svg', 'download-site/orbit-logo.svg'],
      ['public/orbit-logo.svg', 'apps/api/public/orbit-logo.svg'],
      ['public/orbit-icon.png', 'download-site/orbit-icon.png'],
      ['build/icon.png', 'player-app/assets/icon.png'],
      ['build/icon.png', 'player-app/assets/adaptive-icon.png'],
      ['build/icon.png', 'player-app/assets/splash-icon.png']
    ];
    for (const [source, output] of pairs) {
      expect(readFileSync(resolve(repositoryRoot, output))).toEqual(readFileSync(resolve(repositoryRoot, source)));
    }
  }, 20_000);
});
