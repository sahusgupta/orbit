import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

describe('Orbit Player native home design continuity', () => {
  it('keeps the shared palette and compact native game finder presentation', () => {
    const theme = read('player-app/src/styles/playerTheme.ts');
    const home = read('player-app/src/features/home/PlayerHomeScreen.tsx');
    const styles = read('player-app/src/features/home/playerHomeStyles.ts');

    for (const token of [
      "ink: '#f4f7ff'",
      "muted: '#8a9abd'",
      "canvas: '#060c1a'",
      "panel: '#10192c'",
      "primary: '#4d7cfe'",
      "teal: '#35d3a1'",
      "amber: '#a98bff'",
      "coral: '#fb7185'"
    ]) expect(theme).toContain(token);

    for (const token of [
      'export function PlayerHomeScreen(',
      'opportunities.slice(0, 3)',
      'accessibilityRole="header"',
      'accessibilityLabel="Find games"',
      'onPress={onFindGame}',
      'onPress={() => onOpenGame(item)}',
      'onPress={onBrowseTournaments}',
      'onPress={onBrowseClubs}',
      'const city = getClubCity(item.club)',
      'const status = getGameStatusLabel(item.game)',
      '<Text style={styles.availability}>{status}</Text>'
    ]) expect(home).toContain(token);
    expect(home).not.toMatch(/PokerTableAtmosphere|PlayerLandingHero|OrbitJourney|OrbitPlayerFaq|OrbitPlayerFooter/);
    expect(styles).toContain('colors, density, radii, spacing, typography');
    expect(styles).toContain('minHeight: density.touchTarget');
    expect(styles).not.toMatch(/height: 540|height: 330|textShadowRadius/);

    for (const styleName of [
      'home',
      'gameName',
      'findGames',
      'gameList',
      'gameRow',
      'gameCopy',
      'availability',
      'shortcuts',
      'shortcut'
    ]) expect(styles).toMatch(new RegExp(`^  ${styleName}: \\{`, 'm'));
  });

  it('wires the compact home to real navigation, factual inventory states, and guarded game details', () => {
    const playerApp = read('player-app/src/PlayerApp.tsx');
    const playerTypes = read('player-app/src/domain/playerTypes.ts');
    const discoveryDeck = read('player-app/src/features/match/OrbitMatchScreen.tsx');
    const discoveryDetails = read('player-app/src/features/discovery/DiscoveryGameDetails.tsx');
    const home = read('player-app/src/features/home/PlayerHomeScreen.tsx');
    const onboarding = read('player-app/src/features/onboarding/OnboardingScreen.tsx');
    const settings = read('player-app/src/features/settings/SettingsScreen.tsx');

    for (const token of [
      "const [screen, setScreen] = useState<Screen>('home')",
      "{ id: 'home', label: 'Games', icon: 'layers-outline' }",
      "{screen === 'home' ? (",
      '<PlayerHomeScreen',
      'opportunities={broadOpportunities}',
      'inventoryPartial={liveDataPartial}',
      'inventoryStatus={liveDataStatus}',
      "onFindGame={() => { setMatchMode('discover'); setScreen('findGames'); }}",
      'onOpenGame={openDiscoveryGame}',
      "onBrowseTournaments={() => setScreen('tournaments')}",
      "onBrowseClubs={() => setScreen('clubs')}",
      "{screen === 'findGames' ? (",
      '<OrbitMatchScreen',
      'candidates={match.ranked}',
      'savedGames={match.savedGames}',
      "useState<CasinoFilter>('all')",
      'candidateFilter: matchFilter',
      'canUndo={Boolean(match.state.undo)}',
      "setScreen(gameDetailsReturnScreen)",
      "backLabel={gameDetailsReturnScreen === 'home' ? 'Games' : 'Matches'}",
      "readOnly={liveDataStatus !== 'ready'}",
      "tab.id === 'home' && screen === 'findGames'",
      'accessibilityRole="tablist"',
      'accessibilityState={{ selected: active }}'
    ]) expect(playerApp).toContain(token);
    expect(playerApp).not.toMatch(/showHostScreen|PrivateGame|PremiumPaywall/);
    expect(playerTypes).toContain("| 'home'");
    expect(playerApp).not.toContain('discoveryStartY');
    expect(discoveryDeck).toContain('Loading published games');
    expect(discoveryDeck).toContain('Games could not be refreshed');
    expect(discoveryDeck).toContain('More games may be available');
    expect(discoveryDeck).toContain('Refresh to check for additional published games.');
    expect(discoveryDeck).toContain('Excluded venues and strict limits stay in place.');
    expect(discoveryDeck).toContain('Your saved games remain available.');
    expect(playerApp).not.toContain('selectContinuousDiscoveryOpportunities(');
    expect(discoveryDetails).toContain('accessibilityLabel={`Back to ${backLabel}`}');
    expect(discoveryDetails).toContain('<Text style={styles.gameDetailsBackText}>{backLabel}</Text>');
    for (const token of [
      "inventoryStatus === 'ready' && !inventoryPartial",
      "inventoryStatus === 'idle' || inventoryStatus === 'loading'",
      'Loading games',
      'Game data is unavailable.',
      'No games in the venues loaded so far.',
      'Showing loaded venues',
      'Last loaded games',
      'Last loaded: ${status}',
      'No games to show right now.'
    ]) expect(home).toContain(token);
    expect(discoveryDetails).toContain('if (!item || readOnly)');
    expect(playerApp.match(/inventoryStatus=\{liveDataStatus\}/g)).toHaveLength(1);
    expect(playerApp.match(/inventoryPartial=\{liveDataPartial\}/g)).toHaveLength(1);
    expect(playerApp.match(/inventoryStatus=\{matchMode === 'discover' \? match\.discoveryStatus : liveDataStatus\}/g)).toHaveLength(1);
    expect(playerApp.match(/inventoryPartial=\{matchMode === 'discover' \? match\.discoveryPartial : liveDataPartial\}/g)).toHaveLength(1);
    for (const surface of [playerApp, onboarding, settings]) {
      expect(surface).not.toMatch(/<(?:PlayerAmbientFlow|PlayerLandingHero|OrbitJourney|OrbitPlayerFaq|OrbitPlayerFooter)(?:\s|\/|>)/);
    }
  });
});
