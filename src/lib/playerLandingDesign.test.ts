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
      'Current live poker starts here',
      'Find your game.',
      'Current information published by rooms using Orbit Core',
      "id: 'live'",
      "id: 'forming'",
      "id: 'registration'",
      'Pick a card',
      'Now on Orbit',
      'Registration is open',
      'Current rooms',
      'OrbitJourney',
      'A shorter path to the table',
      'OrbitPlayerFaq',
      'Straight answers for live play.',
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
    const onboarding = read('player-app/src/features/onboarding/OnboardingScreen.tsx');
    const settings = read('player-app/src/features/settings/SettingsScreen.tsx');

    for (const token of [
      '<PlayerAmbientFlow />',
      '<PlayerLandingHero',
      'opportunities={displayedOpportunities}',
      'onOpenGame={openDiscoveryGame}',
      "onBrowseTournaments={() => setScreen('tournaments')}",
      "onBrowseClubs={() => setScreen('clubs')}",
      '<OrbitJourney />'
    ]) expect(playerApp).toContain(token);
    expect(onboarding).toContain('<PlayerAmbientFlow />');
    expect(settings).toContain('<OrbitPlayerFaq />');
    expect(settings).toContain('<OrbitPlayerFooter />');
  });
});
