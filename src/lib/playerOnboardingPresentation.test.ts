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
    // Test fixtures are not production presentation owners.
    return ['.ts', '.tsx'].includes(extname(entry.name)) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
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
      // RN 0.86 removed the absoluteFillObject alias. Canonicalize only that
      // API spelling; retain the original digest for every actual style value.
      matches.push(extractBalancedBlock(source, match.index).trim()
        .replace(/\bStyleSheet\.absoluteFill\b/g, 'StyleSheet.absoluteFillObject'));
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
  it('characterizes account-first onboarding while preserving account gates, callbacks, and step animations', () => {
    const sources = parseSources([onboardingFeatureRoot]);
    const componentDigest = digest(componentNames.map((name) => findFunction(sources, name)));
    const shell = findOnboardingShellSource(sources);
    const orderedShellTokens = [
      '<SafeAreaProvider>',
      '<SafeAreaView style={[styles.safeArea, styles.onboardingSafeArea]}>',
      '<StatusBar style={statusBarStyle} />',
      '<AnimatedGradientBackground />',
      '<ScrollView',
      '<OnboardingFlow'
    ];

    // Reviewed account-first flow; Firebase verification and age gates are covered below and in connection/render tests.
    expect(componentDigest).toBe('ec645fe58034e07b5db23f70179564825b3fdd41d7b665c65b95f840ddd35a58');
    orderedShellTokens.forEach((token) => expect(shell).toContain(token));
    expect(shell).toContain('keyboardShouldPersistTaps="handled"');
    expect(shell).toContain('keyboardDismissMode="on-drag"');
    for (let index = 1; index < orderedShellTokens.length; index += 1) {
      expect(shell.indexOf(orderedShellTokens[index])).toBeGreaterThan(shell.indexOf(orderedShellTokens[index - 1]));
    }
    const onboardingFlow = findFunction(sources, 'OnboardingFlow');
    const homeAreaStep = findFunction(sources, 'HomeAreaStep');
    const adultDeclaration = findFunction(sources, 'AdultDeclaration');
    expect(onboardingFlow).toContain('hasAdultDeclaration(draftPlayer)');
    expect(onboardingFlow).toContain('accessibilityLabel="Previous step"');
    expect(onboardingFlow).toContain('accessibilityState={{ disabled: !canSubmit }}');
    expect(onboardingFlow).toContain('onTryDemo?: () => void;');
    expect(onboardingFlow).toContain('onPress={onTryDemo}');
    expect(onboardingFlow).toContain('Explore fictional games at different locations. No sign-in required.');
    expect(onboardingFlow).toContain('Set up your profile');
    expect(onboardingFlow).toContain('Set Match preferences');
    expect(onboardingFlow).toContain('onCompleteWithMatchPreferences?: () => void;');
    expect(findFunction(sources, 'AnimatedGradientBackground')).not.toMatch(/PlayerAmbientFlow|orbitHalo|orbitPattern/);
    expect(homeAreaStep).toContain('<AdultDeclaration');
    expect(adultDeclaration).toContain('I confirm that I am 18 or older');
    expect(adultDeclaration).toContain('accessibilityRole="checkbox"');
    expect(adultDeclaration).toContain('accessibilityState={{ checked: declared, disabled }}');
    expect(findFunction(sources, 'OnboardingWelcome')).toContain('Create account');
    expect(findFunction(sources, 'OnboardingWelcome')).toContain('Try demo account');
    expect(findFunction(sources, 'OnboardingCredentials')).toContain('secureTextEntry');
    expect(findFunction(sources, 'OnboardingCredentials')).toContain('connection.onConnect');
    expect(onboardingFlow).not.toMatch(/LocationStep|MapPicker|device location|text updates/i);
  });

  it('characterizes the reviewed compact onboarding layout and shared styles', () => {
    const sources = parseSources([onboardingFeatureRoot]);
    const styleDigest = digest(styleNames.map((name) => findStyleProperty(sources, name)));

    // Reviewed contrast-safe primary actions and shared 44-point touch targets.
    expect(styleDigest).toBe('cb12a5bec137fab6778d6576eaa46da870087f82730a539a59f6f007c26c57c0');
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
  it('characterizes compact discovery cards and details while preserving callbacks and factual fee labels', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const componentDigest = digest(discoveryComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';

    // Reviewed cash-detail disclosures; action/access/confirmation guards remain covered by render tests.
    expect(componentDigest).toBe('48dcf7852ceda316852fb3841923afda4873e95e41e4cb3e962e98c5a1d6c0e9');
    [
      '<GameDetailsScreen',
      '<MyGamesSection',
      '<DiscoverySearchModal',
      '<OrbitMatchScreen',
      '<MapExploreScreen',
      '<GameFilterPanel',
      '<MapFilterControls'
    ].forEach((token) => expect(playerApp).toContain(token));
    expect(playerApp).not.toMatch(/<DiscoveryDeck|<SavedGamesStrip/);
    expect(playerApp).not.toMatch(/HostControlPanel|PrivateGame|PremiumPaywall|showHostScreen/);
    const gameDetails = findFunction(sources, 'GameDetailsScreen');
    expect(gameDetails).toContain('accessibilityState={{ expanded: section');
    expect(gameDetails).toContain("useState<'rules' | 'structure' | 'request' | null>(null)");
    expect(gameDetails).toContain('getClubFeeProfile(item.club, item.game)');
    expect(gameDetails).toContain('View your request');
    expect(gameDetails).toContain('Continue to request');
    expect(findFunction(sources, 'FiltersBottomSheet')).toContain('doneAccessibilityLabel?: string;');
    expect(playerApp).not.toContain('accessibilityLabel="Demo options"');
    expect(playerApp).toContain('accessibilityLabel="Demo settings"');
  });

  it('characterizes the reviewed mobile discovery layout and shared styles', () => {
    const sources = parseSources([discoveryFeatureRoot]);
    const disclosureStyles = 'cashDetailsHero,cashDetailsIdentity,cashDetailsIdentityCopy,cashDetailsMonogram,cashDetailsMonogramText,cashDetailsVenue,cashDetailsLocation,cashDetailsTitle,cashDetailsAvailability,cashDetailsAvailabilityText,cashDetailsRequestEntry,cashDetailsSections,cashDetailsSectionButton,cashDetailsSectionActive,cashDetailsPanel'.split(',');
    const styleDigest = digest([...discoveryStyleNames, ...disclosureStyles].map((name) => findStyleProperty(sources, name)));

    // All original styles retained; reviewed cash-detail section styles extend their characterization.
    expect(styleDigest).toBe('d142de3250bacec03847857144b65f706cbc34310c0254ddfa1fa051c36c6e21');
    ['chip', 'filterSheetHeaderAction', 'inlineBackAction', 'compactButton', 'secondaryActionButton']
      .forEach((name) => expect(findStyleProperty(sources, name)).toContain('minHeight: 44'));
    expect(findStyleProperty(sources, 'iconActionButton')).toContain('height: 44');
    expect(findStyleProperty(sources, 'iconActionButton')).toContain('width: 44');
  });
});

const tournamentComponentNames = ["TournamentCard","TournamentCardContent","formatPublishedNumber","formatRebuy","formatRebuyStructure","formatAddOnStructure","formatVenueTotals","formatEventDate","TournamentFilterControls"] as const;
const tournamentStyleNames = 'cardTitle,clubMain,compactButton,compactButtonText,disabledAction,emptyState,fieldLabel,filterChipRow,filterPanel,muted,secondaryActionButton,secondaryActionText,sectionHeader,sectionTitle,sheetField,statusPill,statusText,tournamentCard,tournamentCardFeatured,tournamentClosedPill,tournamentClubHeader,tournamentClubSection,tournamentConfirmation,tournamentIcon,tournamentMessage,tournamentMoneyGrid,tournamentMoneyItem,tournamentMoneyItemWide,tournamentMoneyValue,tournamentOpenPill,tournamentPrize,tournamentRule,tournamentRules,tournamentStatLabel,tournamentStats,tournamentStatValue,tournamentStructure,tournamentTitleRow'.split(',');

describe('Player tournament presentation contract', () => {
  it('preserves the characterized cards, factual structure labels, filters, interest callbacks, and route composition', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const componentDigest = digest(tournamentComponentNames.map((name) => findFunction(sources, name)));
    const playerApp = sources.find(({ path }) => path === playerAppPath)?.source ?? '';
    const tournamentScreen = findFunction(sources, 'TournamentScreen');
    const tournamentCard = findFunction(sources, 'TournamentCardContent');

    // Reviewed compact cards with initially closed disclosures; interest semantics remain explicit below.
    expect(componentDigest).toBe('3785ee3104d6e5450c46dad1a46aa108cc6f6a8d09d5449e5854f7e5c1172cdf');
    ['<TournamentScreen', '<TournamentFilterControls'].forEach((token) => expect(playerApp).toContain(token));
    ['<TournamentCard', '<SearchToolbar'].forEach((token) => expect(tournamentScreen).toContain(token));
    expect(tournamentCard).toContain('Express interest');
    expect(tournamentCard).toContain('does not register you, guarantee a seat, create a debt, collect payment, or establish prize eligibility');
    expect(tournamentCard).toContain('Venue staff separately confirms participation.');
    expect(tournamentCard.match(/establish prize eligibility/g)).toHaveLength(1);
    expect(tournamentCard).toContain("useState<'Structure' | 'Rules' | 'Request' | null>(null)");
    expect(tournamentCard).toContain('tournament.registrationAvailable === true');
    expect(tournamentCard).toContain('Register for free');
    expect(tournamentCard).toContain('onRegisterTournament?.()');
  });

  it('characterizes tournament-owned styles and accessible shared touch targets', () => {
    const sources = parseSources([tournamentFeatureRoot]);
    const eventStyles = 'eventCard,eventCardFeatured,eventTopline,eventEyebrow,eventStatus,eventStatusOpen,eventStatusClosed,eventStatusText,eventTitle,eventDate,eventVenue,eventVenueText,eventPriceRow,eventPriceCopy,eventBuyIn,eventCaption,eventInterestStatus,eventInterestStatusText,eventControls,eventControl,eventControlOpen,eventControlText,eventDetails,eventDetailTitle,eventBody,eventStats,eventStat,eventStatValue,eventRequestButton,eventRequestButtonPrimary,eventRequestText'.split(',');
    const styleDigest = digest([...tournamentStyleNames, ...eventStyles].map((name) => findStyleProperty(sources, name)));

    // Existing shared styles retained; reviewed compact event styles add accessible section controls.
    expect(styleDigest).toBe('03f84e606c03057bd511f1547a57ccd7e450ad6ebb1f525467e24d3cb958eda1');
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
    const wallet = findFunction(sources, 'MembershipWalletCard');

    // Reviewed compact membership presentation, named actions and system-theme hooks; QR guards remain below.
    expect(componentDigest).toBe('b5b01972d75051cbb76abd66c7c2402ba78918503325317aedcf5e682c86ec6f');
    ['<ClubsScreen', '<ClubMembershipPlanScreen', '<SeatRequestModal'].forEach((token) => expect(playerApp).toContain(token));
    expect(playerApp).not.toMatch(/ClubAccessCheckoutScreen|NearbyCheckInPanel/);
    expect(clubsScreen).toContain('<ClubHubSections');
    expect(clubsScreen).toContain('demoMode={demoMode}');
    expect(wallet).toContain('demoMode = false');
    expect(wallet).toContain('active && !demoMode ? <MembershipQrIssuer');
    expect(wallet).toContain('Demo membership only. Venue check-in is unavailable in the demo account.');
  });

  it('characterizes clubs/membership-owned styles and accessible shared back actions', () => {
    const sources = parseSources([clubsFeatureRoot, tournamentFeatureRoot]);
    const styleDigest = digest(clubStyleNames.map((name) => findStyleProperty(sources, name)));

    // Reviewed flat membership wallet and accessible club selectors/back actions.
    expect(styleDigest).toBe('66dfbdcae727a26b955740797d34d374305b22278a91816a8ecfd8b9f1605170');
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
  it('keeps compact profile disclosures, guarded editing, account actions, preferences, and legal links', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const settings = findSettingsPresentationSource(sources);
    const orderedTokens = [
      'style={styles.profileHeader}',
      'style={styles.profileName}',
      'title="Sign in"',
      'onPress={connectPlayerAccount}',
      'title="Identity & age"',
      "onPress={() => showIdentityVerification('settings')}",
      'Restoring your signed-in profile',
      'title="Edit profile"',
      'label="Name"',
      'title="Preferences"',
      '<Text style={styles.fieldLabel}>Preferred games</Text>',
      'togglePreferredGame(current, game.id)',
      'title="Support"',
      'title="Privacy Policy"',
      'title="Terms of Service"',
      'title="Try demo account"',
      'onPress={signOutPlayer}',
      'onPress={deletePlayerAccount}'
    ];

    orderedTokens.forEach((token) => expect(settings).toContain(token));
    for (let index = 1; index < orderedTokens.length; index += 1) {
      expect(settings.indexOf(orderedTokens[index])).toBeGreaterThan(settings.indexOf(orderedTokens[index - 1]));
    }
    expect(settings).toContain("firebaseIdentity ? 'Delete account' : 'Delete local profile and data'");
    expect(settings).toContain("useState<'signIn' | 'profile' | 'preferences' | null>(null)");
    expect(settings).toContain('Boolean(firebaseIdentity) && !profileEditingReady');
    expect(settings).toContain('editable={!profileEditingDisabled}');
    expect(settings).toContain('disabled={profileEditingDisabled}');
    expect(settings).not.toMatch(/OrbitPlayerFaq|OrbitPlayerFooter/);
    expect(settings).not.toMatch(/Premium|Purchase|Restore purchases|private game/i);
  });

  it('characterizes compact settings and navigation titles while preserving identity and notification components', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const componentDigest = digest(settingsComponentNames.map((name) => findFunction(sources, name)));

    // Reviewed direct Match preferences entry and OS theme; identity/account guards remain below and in render tests.
    expect(componentDigest).toBe('ff54ca227af86ba67c4792f2ac8839790347d307eae0ec635e6657215f60451f');
    const settings = findSettingsPresentationSource(sources);
    expect(settings).toContain('onTryDemo?: () => void;');
    expect(settings).toContain('onPress={onTryDemo}');
    expect(settings).toContain('title="Match preferences"');
    expect(settings).toContain('onPress={onOpenMatchPreferences}');
  });

  it('characterizes identity/settings-owned styles and accessible shared account actions', () => {
    const sources = parseSources([settingsFeatureRoot]);
    const styleDigest = digest(settingsStyleNames.map((name) => findStyleProperty(sources, name)));

    // Reviewed shared-control update: 44-point retry and secondary account actions.
    expect(styleDigest).toBe('e70191c7d5bab24608241a56869deff9b32c6d7a47753f6cd019881e2fa2cf48');
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
      'shell',
      'header',
      'title',
      'avatar',
      'avatarText',
      'content',
      'matchContent',
      'mainScroll',
      'demoBar',
      'demoLabel',
      'demoOptions',
      'demoOptionsText',
      'demoMenuAction',
      'demoNotice',
      'tabBar',
      'tab',
      'activeTab'
    ]);
    expect(playerApp).toContain('<PlayerHomeScreen');
    expect(playerApp).not.toMatch(/PlayerAmbientFlow|PlayerLandingHero|OrbitJourney/);
  });
});
