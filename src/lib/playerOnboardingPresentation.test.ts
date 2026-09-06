import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const playerSourceRoot = fileURLToPath(new URL('../../player-app/src/', import.meta.url));
const playerAppPath = join(playerSourceRoot, 'PlayerApp.tsx');
const onboardingFeatureRoot = join(playerSourceRoot, 'features', 'onboarding');
const discoveryFeatureRoot = join(playerSourceRoot, 'features', 'discovery');
const tournamentFeatureRoot = join(playerSourceRoot, 'features', 'tournaments');
const clubsFeatureRoot = join(playerSourceRoot, 'features', 'clubs');
const settingsFeatureRoot = join(playerSourceRoot, 'features', 'settings');
const sharedComponentsRoot = join(playerSourceRoot, 'components');
const sharedStylesRoot = join(playerSourceRoot, 'styles');
const playerDomainRoot = join(playerSourceRoot, 'domain');

const componentNames = [
  'OnboardingFlow',
  'AnimatedGradientBackground',
  'OnboardingProgress',
  'AnimatedStepCard',
  'NameStep',
  'EmailStep',
  'PhoneStep',
  'HomeAreaStep',
  'Field'
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
  'secondaryActionButton',
  'secondaryActionText'
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

function parseSources(featureRoots: string[]): ParsedSource[] {
  return [
    playerAppPath,
    ...featureRoots.flatMap((root) => listSourceFiles(root)),
    ...listSourceFiles(sharedComponentsRoot),
    ...listSourceFiles(sharedStylesRoot),
    ...listSourceFiles(playerDomainRoot)
  ].map((path) => ({
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
  return createHash('sha256').update(values.map((value) => value.replace(/\r\n/g, '\n')).join('\n\n')).digest('hex');
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

function findSettingsPresentationSource(sources: ParsedSource[]): string {
  const ownedScreen = sources.map(({ source }) => {
    const match = /^(?:export\s+)?function\s+SettingsScreen\(/m.exec(source);
    return match ? extractFunctionSource(source, match.index) : '';
  }).find(Boolean);
  if (ownedScreen) return ownedScreen;

  const playerApp = (sources.find(({ path }) => path === playerAppPath)?.source ?? '').replace(/\r\n/g, '\n');
  const routeStart = playerApp.indexOf("{screen === 'settings' ? (");
  const presentationStart = playerApp.indexOf('(', routeStart);
  if (routeStart < 0 || presentationStart < 0) throw new Error('Could not find the settings presentation in PlayerApp.');
  return extractBalancedBlock(playerApp, presentationStart, '(', ')');
}

describe('Player onboarding presentation contract', () => {
  it('preserves the characterized component hierarchy, copy, callbacks, and animation implementation', () => {
    const sources = parseSources([onboardingFeatureRoot]);
    const componentDigest = digest(componentNames.map((name) => findFunction(sources, name)));
    const shell = findOnboardingShellSource(sources);
    const orderedShellTokens = [
      '<SafeAreaProvider>',
      '<SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>',
      '<StatusBar style="light" />',
      '<AnimatedGradientBackground />',
      '<ScrollView',
      '<OnboardingFlow'
    ];

    expect(componentDigest).toBe('22c285f74317791bd448a0f015903fe25d1b350b953f90288156b2c65bd8d6ee');
    orderedShellTokens.forEach((token) => expect(shell).toContain(token));
    for (let index = 1; index < orderedShellTokens.length; index += 1) {
      expect(shell.indexOf(orderedShellTokens[index])).toBeGreaterThan(shell.indexOf(orderedShellTokens[index - 1]));
    }
    const onboardingFlow = findFunction(sources, 'OnboardingFlow');
    const homeAreaStep = findFunction(sources, 'HomeAreaStep');
    expect(onboardingFlow).toContain('hasAdultDeclaration(draftPlayer)');
    expect(homeAreaStep).toContain('I confirm that I am 18 or older');
    expect(homeAreaStep).toContain('accessibilityRole="checkbox"');
    expect(onboardingFlow).not.toMatch(/LocationStep|MapPicker|device location|text updates/i);
  });

  it('preserves every onboarding-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([onboardingFeatureRoot]);
    const styleDigest = digest(styleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('0341f87c2759420bc3faccb124ea0c953f98128a00d393ccaf601b7991f28c69');
  });
});

const discoveryComponentNames = [
  "SearchToolbar",
  "DiscoverySearchModal",
  "FiltersBottomSheet",
  "MapExploreScreen",
  "GameFilterPanel",
  "MapFilterControls",
  "IconActionButton",
  "DiscoveryDeck",
  "DiscoveryCardContent",
  "AnimatedDiscoveryCardBackground",
  "getDiscoveryAccent",
  "SavedGamesStrip",
  "GameDetailsScreen",
  "DiscoveryDetailsModal",
  "DetailRow",
  "MyGamesSection",
  "AnimatedSurface",
  "AnimatedButton",
  "getClubFeeProfile",
  "getAccessProfileText",
  "getSeatRequestActionLabel",
  "getMapClubPrimaryAction"
] as const;
const discoveryStyleNames = 'agentKicker,cardCornerAction,cardDetailsAction,cardHouseScroller,cardPickAction,cardRejectAction,cardSelectionRow,cardTitle,clubAvatar,clubAvatarText,clubCard,clubMain,compactButton,compactButtonText,compatibilityBadge,compatibilityLabel,compatibilityValue,detailRow,detailRowLabel,detailRowValue,detailsActionRow,detailsDisclosureGroup,detailsDisclosureLabel,detailsDisclosureRow,detailsInfoCard,detailsPrimaryButton,detailsQuickDivider,detailsQuickSummary,detailsQuickValue,detailsSecondaryButton,detailsSecondaryText,discoveryAccentGlow,discoveryAnimatedBackground,discoveryBuyInLabel,discoveryBuyInRow,discoveryBuyInValue,discoveryCard,discoveryCardBehind,discoveryCardBody,discoveryCardHero,discoveryCardHeroCompact,discoveryCardHeroTop,discoveryCardTop,discoveryClubName,discoveryDeck,discoveryDeckSection,discoveryDetailsContent,discoveryDetailsHeader,discoveryDetailsScore,discoveryDetailsScoreValue,discoveryDetailsSheet,discoveryDetailsTitleBlock,discoveryEmpty,discoveryEmptyIcon,discoveryEmptyTitle,discoveryGameTitle,discoveryHeroBottom,discoveryLocation,discoveryMetric,discoveryMetricLabel,discoveryMetrics,discoveryMetricValue,discoveryNotice,discoveryNoticeText,discoveryProgressFill,discoveryProgressRow,discoveryProgressText,discoveryProgressTrack,discoveryResetButton,discoveryResetText,discoverySavedCount,discoverySearchBackdrop,discoverySearchClose,discoverySearchDone,discoverySearchDoneText,discoverySearchHeader,discoverySearchInput,discoverySearchInputShell,discoverySearchPopup,discoverySearchTitle,emptyState,field,fieldLabel,filterChipRow,filterGrid,filterPanel,filterSheetDismiss,fitBreakdown,formError,gameDetailsBack,gameDetailsBackText,gameDetailsClub,gameDetailsFacts,gameDetailsHero,gameDetailsHeroCopy,gameDetailsHeroTop,gameDetailsLivePill,gameDetailsLiveText,gameDetailsLocation,gameDetailsNav,gameDetailsPage,gameDetailsReason,gameDetailsScore,gameDetailsScoreValue,gameDetailsSection,gameDetailsSectionHeading,gameDetailsSectionIcon,gameDetailsSectionTitle,gameDetailsStatus,gameDetailsTitle,iconActionRow,inlineBackAction,inlineBackText,liveDot,liveDotWarm,liveMap,liveStatusRow,liveStatusText,lockedFilterRow,lockedFilterRowActive,lockedFilterText,mapCanvasLarge,mapCard,mapFooter,membershipTitle,modalBackdrop,modalCloseButton,muted,myGameActions,myGameCard,myGameCardCopy,myGameCardHeader,myGamesCount,myGamesCountText,myGameSecondaryAction,myGameSecondaryActionText,myGamesRail,myGamesSection,myGameStatusBand,myGameStatusDetail,myGameStatusIcon,myGameStatusLabel,notificationPromise,notificationPromiseCopy,notificationPromiseIcon,primaryButton,primaryButtonText,savedGameCopy,savedGameRow,savedGameScore,savedGameScoreValue,savedGamesHeader,savedGamesSection,sectionHeader,sectionTitle,sheetField,sheetHandle,storeButton,storeButtonCopy,storeButtonText,swipeFeedback,swipeFeedbackPass,swipeFeedbackPick,swipeStamp,swipeStampPass,swipeStampPick,swipeStampText,swipeStampTextPass,swipeStampTextPick,venueTypeBadge,venueTypeText'.split(',');

describe('Player discovery presentation contract', () => {
  it('preserves the characterized screens, controls, cards, callbacks, animations, and fee labels', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const componentDigest = digest(discoveryComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';

    expect(componentDigest).toBe('d9fe6426e63d447b34e9618ca2927a1e8c5997b414fa7dbc8ed70f8983180230');
    [
      '<GameDetailsScreen',
      '<MyGamesSection',
      '<DiscoverySearchModal',
      '<DiscoveryDeck',
      '<SavedGamesStrip',
      '<MapExploreScreen',
      '<GameFilterPanel',
      '<MapFilterControls'
    ].forEach((token) => expect(playerApp).toContain(token));
    expect(playerApp).not.toMatch(/HostControlPanel|PrivateGame|PremiumPaywall|showHostScreen/);
  });

  it('preserves every discovery-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const styleDigest = digest(discoveryStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('c2c6c217bebf8b4711dc5ef35dac55fd6c8acded9c41762b788906ea89e2f024');
  });
});

const tournamentComponentNames = ["TournamentCard","formatPublishedNumber","formatRebuy","formatRebuyStructure","formatAddOnStructure","formatVenueTotals","formatEventDate","TournamentFilterControls"] as const;
const tournamentStyleNames = 'cardTitle,clubMain,compactButton,compactButtonText,disabledAction,emptyState,fieldLabel,filterChipRow,filterPanel,muted,secondaryActionButton,secondaryActionText,sectionHeader,sectionTitle,sheetField,statusPill,statusText,tournamentCard,tournamentCardFeatured,tournamentClosedPill,tournamentClubHeader,tournamentClubSection,tournamentConfirmation,tournamentIcon,tournamentMessage,tournamentMoneyGrid,tournamentMoneyItem,tournamentMoneyItemWide,tournamentMoneyValue,tournamentOpenPill,tournamentPrize,tournamentRule,tournamentRules,tournamentStatLabel,tournamentStats,tournamentStatValue,tournamentStructure,tournamentTitleRow'.split(',');

describe('Player tournament presentation contract', () => {
  it('preserves the characterized cards, factual structure labels, filters, interest callbacks, and route composition', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const componentDigest = digest(tournamentComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';
    const tournamentScreen = findFunction(sources, 'TournamentScreen');
    const tournamentCard = findFunction(sources, 'TournamentCard');

    expect(componentDigest).toBe('dcebc1b3d568b49d655448b24a0fc663529dff9ff07a2f8985ed7ce075658e3f');
    ['<TournamentScreen', '<TournamentFilterControls'].forEach((token) => expect(playerApp).toContain(token));
    ['<TournamentCard', '<SearchToolbar'].forEach((token) => expect(tournamentScreen).toContain(token));
    expect(tournamentCard).toContain('Express interest');
    expect(tournamentScreen).toContain('does not register you, guarantee a seat, create a debt, collect payment, or establish prize eligibility');
    expect(tournamentScreen).toContain('Venue staff separately confirms participation.');
    expect(tournamentScreen.match(/establish prize eligibility/g)).toHaveLength(1);
    expect(tournamentScreen).not.toMatch(/Register free|Registration confirmed|Your entry is free/);
  });

  it('preserves every tournament-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const styleDigest = digest(tournamentStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('c404d3c4684d471c0783f296abc18eaf742dde05aa84ea86a76143b092ff78a0');
  });
});

const clubComponentNames = ["ClubMembershipPlanScreen","SeatRequestModal","MembershipPlanCard","formatFamiliar","MembershipApplicationStatusCard","MembershipWalletCard","MembershipQrCode","MembershipQrIssuer","formatQrExpiry","ClubHubSections","PlayerTimePanel","SimpleMenuRow"] as const;
const clubStyleNames = 'accountCard,actionStatus,agentKicker,attendanceChoice,attendanceChoiceActive,attendanceChoiceBody,attendanceChoiceRow,attendanceChoiceTextActive,attendanceChoiceTitle,cardTitle,checkedInBand,checkedInText,clubAvatar,clubAvatarActive,clubAvatarText,clubAvatarTextActive,clubCard,clubGameGroupLabel,clubHub,clubHubCopy,clubHubIcon,clubHubPanel,clubHubRow,clubMain,clubRequestHeader,compactEventRow,compactGameAction,compactGameActionMuted,compactGameCopy,compactGameRow,compactManageButton,compactManageText,compactStatLabel,compactStatValue,disabledAction,emptyState,formError,fullWidthButton,inlineBackAction,inlineBackText,inputLabel,membershipApplicationCard,membershipApplicationStatus,membershipApplicationStatusCopy,membershipApplicationStatusIcon,membershipCompactStats,membershipHero,membershipHeroCopy,membershipHeroIcon,membershipHeroText,membershipIdentityLabel,membershipIdentityRow,membershipIdentityValue,membershipProfileAvatar,membershipProfileAvatarText,membershipProfileCopy,membershipProfileSummary,membershipQrCode,membershipQrCopy,membershipQrMember,membershipQrShell,membershipQrTitle,membershipScreen,membershipStatusBadge,membershipStatusBadgeInactive,membershipStatusDot,membershipStatusDotInactive,membershipStatusText,membershipTitle,membershipWalletBrand,membershipWalletCard,membershipWalletClub,membershipWalletMonogram,membershipWalletMonogramText,membershipWalletPlan,membershipWalletTop,modalBackdrop,modalCloseButton,muted,planCard,planCardCopy,planCardFeatured,planCardPriceBlock,planCompactPrice,planGrid,planIcon,primaryButton,primaryButtonText,qrActionButton,qrActionText,requestGameRow,seatRequestHeader,seatRequestHeaderCopy,seatRequestModal,seatTimeField,seatTimeInput,sectionTitle,selectedCard,statusPill,statusText,timeRangeInput,timeRangeRow'.split(',');

describe('Player clubs and membership presentation contract', () => {
  it('preserves the characterized club, plan, wallet, expiring QR, seat-request, and hub components', () => {
    const sources = parseSources([clubsFeatureRoot, tournamentFeatureRoot]);
    const componentDigest = digest(clubComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';
    const clubsScreen = findFunction(sources, 'ClubsScreen');

    expect(componentDigest).toBe('e406dcc19628a80a2ebdba5763c42a3046e44a49b9fbfd2b6c153804a459c21d');
    ['<ClubsScreen', '<ClubMembershipPlanScreen', '<SeatRequestModal'].forEach((token) => expect(playerApp).toContain(token));
    expect(playerApp).not.toMatch(/ClubAccessCheckoutScreen|NearbyCheckInPanel/);
    expect(clubsScreen).toContain('<ClubHubSections');
  });

  it('preserves every clubs/membership-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([clubsFeatureRoot, tournamentFeatureRoot]);
    const styleDigest = digest(clubStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('4146c16d924c2ea41ec664ed30eebdad2482ea3753aeb0b3c6d36a73a7f898c2');
  });
});

const settingsComponentNames = [
  'SettingsScreen',
  'IdentityVerificationScreen',
  'IdentityPreview',
  'IdentityDetail',
  'InAppNotificationPopup',
  'getScreenTitle',
  'getIdentityStatusLabel',
  'getLatestInAppNotification'
] as const;
const settingsStyleNames = 'accountCard,actionStatus,ageNotice,camera,cameraCaption,cameraGuide,cameraShell,captureActions,cardTitle,chipRow,compactButton,compactButtonText,detailLabel,detailRow,detailValue,disabledAction,emailAuthPanel,emptyState,fieldError,fieldLabel,fullWidthButton,googleAuthBody,googleAuthIcon,googleAuthPanel,identityCard,identityCopy,identityIcon,identityPrivacy,muted,previewCard,previewTitle,primaryButton,primaryButtonText,searchInput,searchInputRow,secondaryActionButton,secondaryActionText,sectionHeader,sectionTitle,simpleMenu'.split(',');

describe('Player identity and settings presentation contract', () => {
  it('preserves the settings hierarchy, guarded editing, account actions, preferences, and legal links', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const settings = findSettingsPresentationSource(sources);
    const orderedTokens = [
      'Profile & settings',
      'Account access',
      'onPress={connectPlayerAccount}',
      'title="Identity & age"',
      "onPress={() => showIdentityVerification('settings')}",
      'Restoring your signed-in profile',
      'label="Name"',
      '<Text style={styles.fieldLabel}>Preferred games</Text>',
      'togglePreferredGame(current, game.id)',
      'title="Support"',
      'title="Privacy Policy"',
      'title="Terms of Service"',
      'onPress={signOutPlayer}',
      'onPress={deletePlayerAccount}'
    ];

    orderedTokens.forEach((token) => expect(settings).toContain(token));
    for (let index = 1; index < orderedTokens.length; index += 1) {
      expect(settings.indexOf(orderedTokens[index])).toBeGreaterThan(settings.indexOf(orderedTokens[index - 1]));
    }
    expect(settings).toContain("firebaseIdentity ? 'Delete account' : 'Delete local profile and data'");
    expect(settings).not.toMatch(/Premium|Purchase|Restore purchases|private game/i);
  });

  it('preserves identity, notification, title, label, and notification-selection behavior byte-for-byte', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const componentDigest = digest(settingsComponentNames.map((name) => findFunction(sources, name)));

    expect(componentDigest).toBe('e6a7dbc3df90097f3b0d956ffbc7dfe9d14276f037e8cbdacc3fe6e572aacbaa');
  });

  it('preserves every identity/settings-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const styleDigest = digest(settingsStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('eabc34d5040cd19c989aaea1136d4f08621780dbe311857ecb606ed66dc20081');
  });
});

describe('Player application shell presentation ownership', () => {
  it('keeps only referenced navigation-shell styles in PlayerApp', () => {
    const playerApp = readFileSync(playerAppPath, 'utf8').replace(/\r\n/g, '\n');
    const declarationStart = playerApp.indexOf('const playerAppStyles = StyleSheet.create(applyDarkComponentTheme({');
    const styleObject = extractBalancedBlock(playerApp, declarationStart);
    const ownedStyles = [...styleObject.matchAll(/^  ([A-Za-z][A-Za-z0-9]*): \{/gm)].map((match) => match[1]);
    const referencedStyles = new Set([...playerApp.matchAll(/styles\.([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]));

    expect(ownedStyles.filter((name) => !referencedStyles.has(name))).toEqual([]);
    expect(ownedStyles).toEqual([
      'appBackdrop',
      'shell',
      'header',
      'eyebrow',
      'title',
      'darkShellEyebrow',
      'darkShellTitle',
      'avatar',
      'avatarText',
      'content',
      'tabBar',
      'tab',
      'activeTab',
      'tabText',
      'activeTabText'
    ]);
  });
});
