import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));

function read(relativePath: string) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

describe('Orbit Player landing design continuity', () => {
  it('carries the player-web landing palette and signature presentation motifs into native components', () => {
    const theme = read('player-app/src/styles/playerTheme.ts');
    const experience = read('player-app/src/features/home/PlayerLandingExperience.tsx');
    const styles = read('player-app/src/features/home/playerLandingStyles.ts');

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
      'PlayerAmbientFlow',
      'PlayerLandingHero',
      'OrbitMark',
      'PokerTableAtmosphere',
      'Current room listings start here',
      'Find your game.',
      'Current information published by rooms using Orbit Core',
      'Start matching',
      "id: 'current'",
      "id: 'forming'",
      "id: 'interest'",
      'Pick a card',
      'Now on Orbit',
      'View matches',
      'Interest open',
      'Current rooms',
      'OrbitJourney',
      'A shorter path to the table',
      'OrbitPlayerFaq',
      'Straight answers for venue listings.',
      'OrbitPlayerFooter',
      'Developed by Caminus Labs, LLC'
    ]) expect(experience).toContain(token);

    for (const styleName of [
      'ambientFlow',
      'heroTitle',
      'pokerCard',
      'cardReadout',
      'nowBoard',
      'liveGameRow',
      'spotlightCard',
      'journey',
      'faqSection',
      'footer'
    ]) expect(styles).toMatch(new RegExp(`^  ${styleName}: \\{`, 'm'));
  });

  it('wires landing controls to real app navigation, inventory, and game details', () => {
    const playerApp = read('player-app/src/PlayerApp.tsx');
    const playerTypes = read('player-app/src/domain/playerTypes.ts');
    const discoveryDeck = read('player-app/src/features/discovery/DiscoveryDeck.tsx');
    const discoveryDetails = read('player-app/src/features/discovery/DiscoveryGameDetails.tsx');
    const onboarding = read('player-app/src/features/onboarding/OnboardingScreen.tsx');
    const settings = read('player-app/src/features/settings/SettingsScreen.tsx');

    for (const token of [
      '<PlayerAmbientFlow />',
      "const [screen, setScreen] = useState<Screen>('home')",
      "{ id: 'home', label: 'Home', icon: 'home-outline' }",
      "{screen === 'home' ? (",
      '<PlayerLandingHero',
      'opportunities={broadOpportunities}',
      'inventoryPartial={liveDataPartial}',
      'inventoryStatus={liveDataStatus}',
      "onFindGame={() => setScreen('findGames')}",
      'onOpenGame={openDiscoveryGame}',
      "onBrowseTournaments={() => setScreen('tournaments')}",
      "onBrowseClubs={() => setScreen('clubs')}",
      "{screen === 'home' ? <OrbitJourney /> : null}",
      "{screen === 'findGames' ? (",
      '<DiscoveryDeck',
      'Swipe left to pass or right to save.',
      "useState<CasinoFilter>('all')",
      'selectContinuousDiscoveryOpportunities(opportunities, broadOpportunities)',
      'No exact filter matches. Showing other published games',
      "setScreen(gameDetailsReturnScreen)",
      "backLabel={gameDetailsReturnScreen === 'home' ? 'Home' : 'Matches'}",
      "tab.id === 'home' && screen === 'findGames'",
      'accessibilityRole="tablist"',
      'accessibilityState={{ selected: active }}'
    ]) expect(playerApp).toContain(token);
    expect(playerApp).not.toMatch(/showHostScreen|PrivateGame|PremiumPaywall/);
    expect(playerTypes).toContain("| 'home'");
    expect(playerApp).not.toContain('discoveryStartY');
    expect(discoveryDeck).toContain('Loading published matches');
    expect(discoveryDeck).toContain('Published matches unavailable');
    expect(discoveryDeck).toContain('More matches are loading');
    expect(discoveryDeck).toContain('No matches are in the rooms loaded so far. More rooms are still refreshing.');
    expect(discoveryDeck).toContain('Orbit checks again automatically');
    expect(discoveryDetails).toContain('accessibilityLabel={`Back to ${backLabel}`}');
    expect(discoveryDetails).toContain('<Text style={styles.gameDetailsBackText}>{backLabel}</Text>');
    expect(read('player-app/src/features/home/PlayerLandingExperience.tsx')).toContain('Published games unavailable');
    expect(playerApp.match(/inventoryStatus=\{liveDataStatus\}/g)).toHaveLength(2);
    expect(playerApp.match(/inventoryPartial=\{liveDataPartial\}/g)).toHaveLength(2);
    expect(onboarding).toContain('<PlayerAmbientFlow />');
    expect(settings).toContain('<OrbitPlayerFaq />');
    expect(settings).toContain('<OrbitPlayerFooter />');
  });
});
