import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function productionSources(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return productionSources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('Player conservative-release source boundary', () => {
  const sourceRoot = resolve(process.cwd(), 'player-app/src');

  it('contains no reachable removed feature modules or synthetic geography residue', () => {
    const prohibited = /usePlayerPremium|usePlayerPrivateGames|applePurchases|privateGameRepository|DiscoveryHosting|MapPicker|RevenueCat|purchases-react-native|checkout|tournament-registrations|tournamentRegistrations|Bryan|College Station|30\.613|-96\.342|defaultRegion/i;
    const violations = productionSources(sourceRoot).flatMap((path) => {
      const match = prohibited.exec(readFileSync(path, 'utf8'));
      return match ? [`${relative(sourceRoot, path)}: ${match[0]}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it('keeps phone and game communication copy truthful and in-app-only', () => {
    const onboarding = readFileSync(join(sourceRoot, 'features/onboarding/OnboardingScreen.tsx'), 'utf8');
    const settings = readFileSync(join(sourceRoot, 'features/settings/SettingsScreen.tsx'), 'utf8');
    expect(onboarding).toContain('game and waitlist updates stay inside Orbit');
    expect(onboarding).toContain('e164PhoneExample');
    expect(onboarding).toContain('e164PhoneRequirement');
    expect(settings).toContain('e164PhoneExample');
    expect(settings).toContain('e164PhoneRequirement');
    expect(onboarding).not.toMatch(/valid 10-digit phone/i);
    expect(onboarding).not.toMatch(/text updates about games|we(?:'|’)ll text|SMS game updates/i);

    const unsupportedClaims = /game alerts|push alerts|we(?:'|’)ll notify you|saved for retry/i;
    const violations = productionSources(sourceRoot).flatMap((path) => {
      const match = unsupportedClaims.exec(readFileSync(path, 'utf8'));
      return match ? [`${relative(sourceRoot, path)}: ${match[0]}`] : [];
    });
    expect(violations).toEqual([]);
  });

  it('does not render the legacy synthetic loyalty tiers or points product', () => {
    const membershipUi = [
      readFileSync(join(sourceRoot, 'features/clubs/ClubHub.tsx'), 'utf8'),
      readFileSync(join(sourceRoot, 'features/clubs/MembershipWallet.tsx'), 'utf8')
    ].join('\n');
    expect(membershipUi).not.toMatch(/\.loyalty\b|>Points<|>Tier</);
  });

  it('wires identity capture to an opaque mutation ID without embedding the Firebase UID', () => {
    const identityHook = readFileSync(join(sourceRoot, 'application/usePlayerIdentity.ts'), 'utf8');
    expect(identityHook).toContain("createOpaquePlayerId('identity')");
    expect(identityHook).not.toContain('identity:${firebaseIdentity.uid}');
  });

  it('uses the canonical adult-declaration validator when restoring a completed local account', () => {
    const storageHook = readFileSync(join(sourceRoot, 'application/usePlayerStorage.ts'), 'utf8');
    expect(storageHook).toContain('setHasAccount(hasAdultDeclaration(result.player))');
    expect(storageHook).not.toContain("Boolean(result.player.adultDeclaredAt && result.player.adultDeclarationVersion === 'v1')");
  });

  it('does not derive or display a stable membership credential beside the short-lived QR token', () => {
    const wallet = readFileSync(join(sourceRoot, 'features/clubs/MembershipWallet.tsx'), 'utf8');
    expect(wallet).not.toMatch(/getMembershipDisplayId|MEMBER ID|memberId/);
    expect(wallet).toContain('accessibilityLabel="Membership check-in QR"');
    expect(wallet).toContain('Expiration unavailable');
  });
});
