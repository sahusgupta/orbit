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
  'LocationStep',
  'RadiusStep',
  'GameStep',
  'StakesStep',
  'StepHeader',
  'MapPicker',
  'Field',
  'Chip'
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
  'stepHeaderText',
  'mapCard',
  'mapCanvas',
  'liveMap',
  'mapFooter',
  'cardTitle',
  'muted',
  'field',
  'fieldLabel',
  'fieldLabelLight',
  'input',
  'inputLight',
  'inputError',
  'fieldError',
  'fieldErrorLight',
  'chip',
  'chipActive',
  'chipText',
  'chipTextActive'
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

    expect(componentDigest).toBe('377a8db107faa79761749da3892d72de73f35dfe8f633bdeba89d1765cc502ad');
    orderedShellTokens.forEach((token) => expect(shell).toContain(token));
    for (let index = 1; index < orderedShellTokens.length; index += 1) {
      expect(shell.indexOf(orderedShellTokens[index])).toBeGreaterThan(shell.indexOf(orderedShellTokens[index - 1]));
    }
  });

  it('preserves every onboarding-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([onboardingFeatureRoot]);
    const styleDigest = digest(styleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('84c330c07bfb648c1646a74ab6f96a196eed59308df7e626313807e27d6c4c44');
  });
});

const discoveryComponentNames = [
  "SearchToolbar",
  "DiscoverySearchModal",
  "FiltersBottomSheet",
  "MapExploreScreen",
  "GameFilterPanel",
  "MapFilterControls",
  "DistanceFilterControl",
  "IconActionButton",
  "PremiumPaywall",
  "HostControlPanel",
  "PrivateGameComposer",
  "PrivateGameCard",
  "DiscoveryDeck",
  "DiscoveryCardContent",
  "AnimatedDiscoveryCardBackground",
  "getDiscoveryAccent",
  "SavedGamesStrip",
  "GameDetailsScreen",
  "DiscoveryDetailsModal",
  "DetailRow",
  "OpportunitySectionList",
  "OpportunityCard",
  "GameCard",
  "MyGamesSection",
  "AnimatedSurface",
  "AnimatedButton",
  "getClubProductName",
  "formatDropFee",
  "getClubProductLabel",
  "getClubMembershipPrices",
  "getClubFeeProfile",
  "getAccessProfileText"
] as const;
const discoveryStyleNames = 'agentCopy,agentHeader,agentIcon,agentKicker,agentPanel,animatedButtonShadow,buttonGradient,cardCornerAction,cardDetailsAction,cardHouseScroller,cardPickAction,cardRejectAction,cardSelectionRow,cardTitle,clubAvatar,clubAvatarText,clubCard,clubFolder,clubFolderAvatar,clubFolderAvatarText,clubFolderCopy,clubFolderGames,clubFolderHeader,clubFolderTitleRow,clubMain,compatibilityBadge,compatibilityLabel,compatibilityValue,composerGrid,contextChip,contextRow,contextText,detailRow,detailRowLabel,detailRowValue,detailsActionRow,detailsDisclosureGroup,detailsDisclosureLabel,detailsDisclosureRow,detailsInfoCard,detailsPrimaryButton,detailsQuickDivider,detailsQuickSummary,detailsQuickValue,detailsSecondaryButton,detailsSecondaryText,disabledButton,discoveryAccentGlow,discoveryAnimatedBackground,discoveryBuyInLabel,discoveryBuyInRow,discoveryBuyInValue,discoveryCard,discoveryCardBehind,discoveryCardBody,discoveryCardHero,discoveryCardHeroCompact,discoveryCardHeroTop,discoveryCardTop,discoveryClubName,discoveryDeck,discoveryDeckSection,discoveryDetailsContent,discoveryDetailsHeader,discoveryDetailsScore,discoveryDetailsScoreValue,discoveryDetailsSheet,discoveryDetailsTitleBlock,discoveryEmpty,discoveryEmptyIcon,discoveryEmptyTitle,discoveryGameTitle,discoveryHeroBottom,discoveryLocation,discoveryMetric,discoveryMetricLabel,discoveryMetricValue,discoveryMetrics,discoveryNotice,discoveryNoticeText,discoveryProgressFill,discoveryProgressRow,discoveryProgressText,discoveryProgressTrack,discoveryQuickFilter,discoveryQuickFilterActive,discoveryQuickFilterText,discoveryQuickFilterTextActive,discoveryQuickFilters,discoveryResetButton,discoveryResetText,discoverySavedCount,discoverySearchBackdrop,discoverySearchClose,discoverySearchDone,discoverySearchDoneText,discoverySearchHeader,discoverySearchInput,discoverySearchInputShell,discoverySearchPopup,discoverySearchTitle,discoveryToolbar,discoveryToolbarButton,discoveryToolbarButtonActive,discoveryToolbarText,discoveryToolbarTextActive,distanceChip,distanceChipActive,distanceChipText,distanceChipTextActive,distanceRow,emptyState,favoriteBadge,favoriteBadgeText,feeInfoBand,feeInfoText,feeTypePill,feeTypePillText,feedAvatar,feedAvatarText,field,fieldLabel,filterChipRow,filterGrid,filterPanel,filterSheetBackdrop,filterSheetCard,filterSheetContent,filterSheetDismiss,filterSheetDoneAction,filterSheetDoneText,filterSheetHandle,filterSheetHeader,filterSheetHeaderAction,filterSheetResetText,filterSheetTitle,fitBreakdown,fullWidthButton,gameActionRow,gameCard,gameDetailsBack,gameDetailsBackText,gameDetailsClub,gameDetailsFacts,gameDetailsHero,gameDetailsHeroCopy,gameDetailsHeroTop,gameDetailsLivePill,gameDetailsLiveText,gameDetailsLocation,gameDetailsNav,gameDetailsPage,gameDetailsReason,gameDetailsScore,gameDetailsScoreValue,gameDetailsSection,gameDetailsSectionHeading,gameDetailsSectionIcon,gameDetailsSectionTitle,gameDetailsStatus,gameDetailsTitle,gameHeader,gameTitleBlock,hostPromptCard,hostPromptCopy,hostPromptIcon,iconActionButton,iconActionButtonActive,iconActionButtonDisabled,iconActionRow,iconTooltip,iconTooltipText,inlineBackAction,inlineBackText,liveDot,liveDotWarm,liveMap,liveStatusRow,liveStatusText,lockedFilterRow,lockedFilterRowActive,lockedFilterText,lockedRecommendationBand,lockedRecommendationText,mapCanvasLarge,mapCard,mapFooter,membershipTitle,modalBackdrop,modalCloseButton,muted,myGameActions,myGameCard,myGameCardCopy,myGameCardHeader,myGameMerchantNote,myGamePrimaryAction,myGamePrimaryActionText,myGameSecondaryAction,myGameSecondaryActionText,myGameStatusBand,myGameStatusDetail,myGameStatusIcon,myGameStatusLabel,myGamesCount,myGamesCountText,myGamesRail,myGamesSection,notificationPromise,notificationPromiseCopy,notificationPromiseIcon,offeredGameBand,offeredGameText,openPill,paywallHeader,paywallIcon,paywallPanel,plainFiltersButton,plainFiltersText,plainSearchBar,preferenceBand,preferenceText,priceRow,priceText,primaryButton,primaryButtonText,privateBadge,privateBadgeText,privateGameCard,privateGameComposer,privateGameMarker,privateGameMarkerInner,privateGameStatus,publishPrivateGame,publishPrivateGameDisabled,publishPrivateGameText,rakeTypePill,rakeTypePillText,recommendationBadge,recommendationBadgeText,recommendationBand,recommendationText,savedGameCopy,savedGameRow,savedGameScore,savedGameScoreValue,savedGamesHeader,savedGamesSection,searchInput,searchToolbar,sectionHeader,sectionTitle,sheetField,sheetHandle,sheetTextInput,statusPill,statusText,storeButton,storeButtonCopy,storeButtonText,swipeFeedback,swipeFeedbackPass,swipeFeedbackPick,swipeStamp,swipeStampPass,swipeStampPick,swipeStampText,swipeStampTextPass,swipeStampTextPick,tableName,tableRow,tableSeats,valuePill,valuePillText,valueRow,venueTypeBadge,venueTypeText,waitlistAheadBand,waitlistAheadText,waitlistPill,waitlistPillText'.split(',');

describe('Player discovery presentation contract', () => {
  it('preserves the characterized screens, controls, cards, callbacks, animations, and fee labels', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const componentDigest = digest(discoveryComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';

    expect(componentDigest).toBe('380244f439c848afaa21ec21f64ca3abd530e7df1b933909044dca5ddc23f45c');
    [
      '<GameDetailsScreen',
      '<MyGamesSection',
      '<DiscoverySearchModal',
      '<DiscoveryDeck',
      '<SavedGamesStrip',
      '<MapExploreScreen',
      '<HostControlPanel',
      '<PrivateGameComposer',
      '<PremiumPaywall',
      '<GameFilterPanel',
      '<MapFilterControls'
    ].forEach((token) => expect(playerApp).toContain(token));
  });

  it('preserves every discovery-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const styleDigest = digest(discoveryStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('05afe4a318ce1f1cd71d7b6529ccba3855370a0093daeaaa476f3bc54da95168');
  });
});

const tournamentComponentNames = ["TournamentCard","formatEventDate","TournamentFilterControls"] as const;
const tournamentStyleNames = 'cardTitle,clubMain,compactButton,compactButtonText,disabledAction,emptyState,fieldLabel,filterChipRow,filterPanel,muted,secondaryActionButton,secondaryActionText,sectionHeader,sectionTitle,sheetField,sheetTextInput,statusPill,statusText,tournamentCard,tournamentCardFeatured,tournamentClosedPill,tournamentClubHeader,tournamentClubSection,tournamentConfirmation,tournamentIcon,tournamentMessage,tournamentMoneyGrid,tournamentMoneyItem,tournamentMoneyItemWide,tournamentMoneyValue,tournamentOpenPill,tournamentPrize,tournamentRule,tournamentRules,tournamentStatLabel,tournamentStatValue,tournamentStats,tournamentStructure,tournamentTitleRow'.split(',');

describe('Player tournament presentation contract', () => {
  it('preserves the characterized cards, date labels, filters, registration callbacks, and route composition', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const componentDigest = digest(tournamentComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';
    const tournamentScreen = findFunction(sources, 'TournamentScreen');

    expect(componentDigest).toBe('6934283c085b039e9a228f01bb340e6e14b7e75274517b8f70d533b2d937f516');
    ['<TournamentScreen', '<TournamentFilterControls'].forEach((token) => expect(playerApp).toContain(token));
    ['<TournamentCard', '<SearchToolbar'].forEach((token) => expect(tournamentScreen).toContain(token));
  });

  it('preserves every tournament-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const styleDigest = digest(tournamentStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('42b9dc43f1ed214b7ae1aa9effd3c1da09f473f5f9614fa02491351c08e2f6f8');
  });
});

const clubComponentNames = ["NearbyCheckInPanel","ClubMembershipPlanScreen","SeatRequestModal","ClubAccessCheckoutScreen","MembershipPlanCard","formatFamiliar","MembershipApplicationStatusCard","MembershipWalletCard","MembershipQrCode","getMembershipDisplayId","ClubHubSections","SimpleMenuRow","ClubMembershipPanel","ClubHistoryPanel"] as const;
const clubStyleNames = 'accountCard,agentKicker,attendanceChoice,attendanceChoiceActive,attendanceChoiceBody,attendanceChoiceRow,attendanceChoiceTextActive,attendanceChoiceTitle,buyAnotherPassButton,buyAnotherPassText,cardTitle,checkedInBand,checkedInText,clubAvatar,clubAvatarActive,clubAvatarText,clubAvatarTextActive,clubCard,clubGameGroupLabel,clubHub,clubHubCopy,clubHubIcon,clubHubPanel,clubHubRow,clubMain,clubRequestHeader,compactEventRow,compactGameAction,compactGameActionMuted,compactGameCopy,compactGameRow,compactManageButton,compactManageText,compactStatLabel,compactStatValue,emptyState,formError,fullWidthButton,iconActionRow,inlineBackAction,inlineBackText,inputLabel,loyaltyBadge,loyaltyBadgeText,loyaltyCard,loyaltyHeader,membershipApplicationCard,membershipApplicationStatus,membershipApplicationStatusCopy,membershipApplicationStatusIcon,membershipCompactStats,membershipHero,membershipHeroCopy,membershipHeroIcon,membershipHeroText,membershipIdentityLabel,membershipIdentityRow,membershipIdentityValue,membershipNumberBlock,membershipProfileAvatar,membershipProfileAvatarText,membershipProfileCopy,membershipProfileSummary,membershipQrCode,membershipQrCopy,membershipQrMember,membershipQrShell,membershipQrTitle,membershipScreen,membershipStatusBadge,membershipStatusBadgeInactive,membershipStatusDot,membershipStatusDotInactive,membershipStatusText,membershipTitle,membershipWalletBrand,membershipWalletCard,membershipWalletClub,membershipWalletMonogram,membershipWalletMonogramText,membershipWalletPlan,membershipWalletTop,merchantBand,merchantBandText,modalBackdrop,modalCloseButton,muted,passTimer,passTimerActive,passTimerCopy,passTimerInactive,passTimerTitle,payInPersonButton,payInPersonCopy,paymentPlaceholder,paymentPlaceholderIcon,planCard,planCardCopy,planCardFeatured,planCardPriceBlock,planCompactPrice,planGrid,planIcon,points,primaryButton,primaryButtonText,privateGameStatus,requestGameRow,seatRequestHeader,seatRequestHeaderCopy,seatRequestModal,seatTimeField,seatTimeInput,sectionHeader,sectionTitle,selectedCard,simpleMenuCopy,simpleMenuIcon,simpleMenuRow,statusPill,statusText,timeRangeInput,timeRangeRow'.split(',');

describe('Player clubs and membership presentation contract', () => {
  it('preserves the characterized club, plan, checkout, wallet, QR, seat-request, and hub components', () => {
    const sources = parseSources([clubsFeatureRoot, tournamentFeatureRoot]);
    const componentDigest = digest(clubComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';
    const clubsScreen = findFunction(sources, 'ClubsScreen');

    expect(componentDigest).toBe('1127a7ac230c9fa747f8a9df27a9947edc1c6d621a06785b3b1436b7f488ed65');
    ['<ClubsScreen', '<ClubMembershipPlanScreen', '<ClubAccessCheckoutScreen', '<SeatRequestModal'].forEach((token) => expect(playerApp).toContain(token));
    expect(clubsScreen).toContain('<ClubHubSections');
  });

  it('preserves every clubs/membership-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([clubsFeatureRoot, tournamentFeatureRoot]);
    const styleDigest = digest(clubStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('5ecff9fa0adc610399f875e882be73c31d55c9af7c7f4a2d7a717441bba5a064');
  });
});

const settingsComponentNames = [
  'IdentityVerificationScreen',
  'InAppNotificationPopup',
  'getScreenTitle',
  'getIdentityStatusLabel',
  'getLatestInAppNotification'
] as const;
const settingsStyleNames = 'accountCard,alertPopup,alertPopupBody,alertPopupClose,alertPopupCopy,alertPopupIcon,alertPopupTitle,alertToastHost,cardTitle,chipRow,compactButton,compactButtonText,disabledAction,emailAuthPanel,fieldLabel,fullWidthButton,googleAuthBody,googleAuthIcon,googleAuthPanel,identityCard,identityCopy,identityIcon,identityPrivacy,muted,primaryButton,primaryButtonText,privateGameStatus,searchInput,searchInputRow,secondaryActionButton,secondaryActionText,sectionHeader,sectionTitle,simpleMenu,simpleMenuCopy,simpleMenuIcon,simpleMenuRow'.split(',');

describe('Player identity and settings presentation contract', () => {
  it('preserves the settings hierarchy, copy, account actions, preferences, legal links, and premium controls', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const settings = findSettingsPresentationSource(sources);
    const orderedTokens = [
      'Profile & settings',
      'Account access',
      'onPress={connectPlayerAccount}',
      'title="Identity & age"',
      "onPress={() => showIdentityVerification('settings')}",
      'playerPremiumEnabled ? (',
      'onPress={openPremiumCheckout}',
      'onPress={restorePremiumPurchases}',
      '<Field label="Name"',
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
  });

  it('preserves identity, notification, title, label, and notification-selection behavior byte-for-byte', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const componentDigest = digest(settingsComponentNames.map((name) => findFunction(sources, name)));

    expect(componentDigest).toBe('9734431411a32ce83dea7529a7d5f87a65dcc0e873221a099548252ecc7ce012');
  });

  it('preserves every identity/settings-owned and shared style value byte-for-byte', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const styleDigest = digest(settingsStyleNames.map((name) => findStyleProperty(sources, name)));

    expect(styleDigest).toBe('37728a689cf40a072fff128496a9ac574b7b241ea1fffcf66b170c01b3883286');
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
