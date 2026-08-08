import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const playerSourceRoot = fileURLToPath(new URL('../../player-app/src/', import.meta.url));
const playerAppPath = join(playerSourceRoot, 'PlayerApp.tsx');
const onboardingFeatureRoot = join(playerSourceRoot, 'features', 'onboarding');

const componentNames = [
  'OnboardingFlow',
  'AnimatedGradientBackground',
  'OnboardingProgress',
  'AnimatedStepCard',
  'NameStep',
  'EmailStep',
  'PhoneStep',
  'HomeAreaStep',
  'LocationStep',
  'RadiusStep',
  'GameStep',
  'StakesStep',
  'StepHeader'
] as const;

const styleNames = [
  'safeArea',
  'onboardingSafeArea',
  'onboardingShell',
  'onboardingContent',
  'animatedGradientRoot',
  'arrowAction',
  'arrowActionDisabled',
  'chipRow',
  'gradientShade',
  'iconTooltip',
  'iconTooltipText',
  'onboardingActions',
  'onboardingBrand',
  'onboardingBrandSubtle',
  'onboardingFlow',
  'onboardingNextAction',
  'onboardingNextActionText',
  'onboardingProgressFill',
  'onboardingProgressShell',
  'onboardingProgressTrack',
  'onboardingStepSurface',
  'onboardingTitle',
  'onboardingTopBar',
  'optionalStep',
  'optionalStepText',
  'orbitHalo',
  'orbitNode',
  'orbitNodeFour',
  'orbitNodeOne',
  'orbitNodeThree',
  'orbitNodeTwo',
  'orbitPattern',
  'orbitRing',
  'sectionTitle',
  'stepHeader',
  'stepHeaderIcon',
  'stepHeaderText'
] as const;

type ParsedSource = {
  path: string;
  source: string;
};

function listSourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

function parseSources(): ParsedSource[] {
  return [playerAppPath, ...listSourceFiles(onboardingFeatureRoot)].map((path) => ({
    path,
    source: readFileSync(path, 'utf8')
  }));
}

function findBalancedEnd(source: string, start: number, openingCharacter: string, closingCharacter: string): number {
  const bodyStart = source.indexOf(openingCharacter, start);
  if (bodyStart < 0) throw new Error(`Could not find ${openingCharacter} after offset ${start}.`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === openingCharacter) depth += 1;
    if (source[index] === closingCharacter) depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error(`Could not find ${closingCharacter} after offset ${start}.`);
}

function extractBalancedBlock(source: string, start: number, openingCharacter = '{', closingCharacter = '}'): string {
  return source.slice(start, findBalancedEnd(source, start, openingCharacter, closingCharacter) + 1);
}

function extractFunctionSource(source: string, start: number): string {
  const parametersStart = source.indexOf('(', start);
  const parametersEnd = findBalancedEnd(source, parametersStart, '(', ')');
  return source.slice(start, findBalancedEnd(source, parametersEnd + 1, '{', '}') + 1);
}

function findFunction(sources: ParsedSource[], name: string): string {
  const matches: string[] = [];
  sources.forEach(({ source }) => {
    const pattern = new RegExp(`^(?:export\\s+)?function\\s+${name}\\(`, 'm');
    const match = pattern.exec(source);
    if (match) matches.push(extractFunctionSource(source, match.index).replace(/^export\s+/, ''));
  });
  expect(matches, `${name} should have exactly one presentation owner`).toHaveLength(1);
  return matches[0];
}

function findStyleProperty(sources: ParsedSource[], name: string): string {
  const matches: string[] = [];
  sources.forEach(({ source }) => {
    const pattern = new RegExp(`^  ${name}: \\{`, 'gm');
    for (const match of source.matchAll(pattern)) {
      matches.push(extractBalancedBlock(source, match.index).trim());
    }
  });
  expect(matches, `${name} should have exactly one characterized style owner`).toHaveLength(1);
  return matches[0];
}

function digest(values: string[]): string {
  return createHash('sha256').update(values.join('\n\n')).digest('hex');
}

function findOnboardingShellSource(sources: ParsedSource[]): string {
  const ownedScreen = sources.map(({ source }) => {
    const match = /^(?:export\s+)?function\s+OnboardingScreen\(/m.exec(source);
    return match ? extractFunctionSource(source, match.index) : '';
  }).find(Boolean);
  if (ownedScreen) return ownedScreen;

  const playerApp = (sources.find(({ path }) => path === playerAppPath)?.source ?? '').replace(/\r\n/g, '\n');
  const start = playerApp.indexOf('if (!hasAccount) {');
  const end = playerApp.indexOf('\n\n  return (', start);
  if (start < 0 || end < 0) throw new Error('Could not find the onboarding shell in PlayerApp.');
  return playerApp.slice(start, end);
}

describe('Player onboarding presentation contract', () => {
  it('preserves the characterized component hierarchy, copy, callbacks, and animation implementation', () => {
    const sources = parseSources();
    const componentDigest = digest(componentNames.map((name) => findFunction(sources, name)));
    const shell = findOnboardingShellSource(sources);
    const orderedShellTokens = [
      '<SafeAreaProvider>',
      '<SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>',
      '<StatusBar style="dark" />',
      '<AnimatedGradientBackground />',
      '<ScrollView',
      '<OnboardingFlow'
    ];

    expect(componentDigest).toBe('f33bff66fd83043cf8805852e61626b4a5812e64329b9e93c6d53aff7964af6c');
    orderedShellTokens.forEach((token) => expect(shell).toContain(token));
    for (let index = 1; index < orderedShellTokens.length; index += 1) {
      expect(shell.indexOf(orderedShellTokens[index])).toBeGreaterThan(shell.indexOf(orderedShellTokens[index - 1]));
    }
  });

  it('preserves every onboarding-owned and shared style value byte-for-byte', () => {
    const sources = parseSources();
    const styleDigest = digest(styleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('2b33fedabd50302767bf99950b4d4b0542582eb825e39e8066bf0c9fce0906d6');
  });
});
