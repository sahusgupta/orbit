import { Platform, StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from '../../styles/playerTheme';

export const discoveryStyles = StyleSheet.create(applyDarkComponentTheme({
  agentCopy: {
    flex: 1,
    gap: 3
  },
  agentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11
  },
  agentIcon: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    position: 'relative',
    width: 42
  },
  agentPanel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  cardCornerAction: { alignItems: 'center', borderRadius: 999, height: 56, justifyContent: 'center', width: 56 },
  cardDetailsAction: { backgroundColor: '#1a2340', borderColor: 'rgba(77,124,254,0.42)', borderWidth: 1.5 },
  cardHouseScroller: {
    paddingBottom: Platform.OS === 'web' ? 8 : 0
  },
  cardPickAction: { backgroundColor: colors.primary, height: 68, shadowColor: colors.primary, shadowOffset: { width: 0, height: 9 }, shadowOpacity: 0.44, shadowRadius: 18, width: 68 },
  cardRejectAction: { backgroundColor: '#1a2340', borderColor: '#f43f5e', borderWidth: 1.5 },
  cardSelectionRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' },
  clubFolder: {
    gap: 9
  },
  clubFolderAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  clubFolderAvatarText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700'
  },
  clubFolderCopy: {
    flex: 1,
    gap: 4
  },
  clubFolderGames: {
    gap: 9,
    paddingLeft: 10
  },
  clubFolderHeader: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    padding: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  clubFolderTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  compatibilityBadge: { alignItems: 'center', backgroundColor: 'rgba(8,12,24,0.72)', borderRadius: 16, borderWidth: 1, minWidth: 66, paddingHorizontal: 10, paddingVertical: 8 },
  compatibilityLabel: { color: colors.primary, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  compatibilityValue: { color: colors.primaryDark, fontSize: 11, fontWeight: '700', lineHeight: 14, textAlign: 'center' },
  composerGrid: {
    flexDirection: 'row',
    gap: 10
  },
  contextChip: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  contextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  contextText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700'
  },
  detailRow: { alignItems: 'flex-start', flexDirection: 'row', gap: 8, justifyContent: 'space-between' },
  detailRowLabel: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  detailRowValue: { color: colors.ink, flex: 1, fontSize: 12, fontWeight: '700', textAlign: 'right' },
  detailsActionRow: { flexDirection: 'row', gap: 9 },
  detailsDisclosureGroup: { borderColor: colors.line, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  detailsDisclosureLabel: { alignItems: 'center', flexDirection: 'row', gap: 9 },
  detailsDisclosureRow: { alignItems: 'center', backgroundColor: '#ffffff', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 13 },
  detailsInfoCard: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  detailsPrimaryButton: { minWidth: 184 },
  detailsQuickDivider: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  detailsQuickSummary: { alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 11 },
  detailsQuickValue: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  detailsSecondaryButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 11, borderWidth: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 46, paddingHorizontal: 13 },
  detailsSecondaryText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  disabledButton: {
    backgroundColor: '#a7aaa4'
  },
  discoveryAccentGlow: { borderRadius: 999, height: 190, opacity: 0.10, position: 'absolute', right: -55, top: -45, width: 190 },
  discoveryAnimatedBackground: { ...StyleSheet.absoluteFillObject, backgroundColor: '#07101f', overflow: 'hidden' },
  discoveryBuyInLabel: { color: 'rgba(255,255,255,0.32)', fontSize: 10, fontWeight: '700', letterSpacing: 1.4 },
  discoveryBuyInRow: { alignItems: 'center', borderTopColor: 'rgba(255,255,255,0.10)', borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 11 },
  discoveryBuyInValue: { color: 'rgba(255,255,255,0.72)', fontSize: 13, fontWeight: '700' },
  discoveryCard: {
    backgroundColor: '#0d1525',
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 28,
    borderWidth: 1,
    bottom: 0,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.28,
    shadowRadius: 32,
    top: 0
  },
  discoveryCardBehind: { bottom: -8, opacity: 0.52, top: 15, transform: [{ scale: 0.955 }], zIndex: 1 },
  discoveryCardBody: { flex: 1, gap: 13, justifyContent: 'space-between', padding: 18, paddingTop: 15 },
  discoveryCardHero: { height: 312, justifyContent: 'space-between', overflow: 'hidden', padding: 21 },
  discoveryCardHeroCompact: { height: 312 },
  discoveryCardHeroTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  discoveryCardTop: { zIndex: 2 },
  discoveryClubName: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  discoveryDeck: { height: 540, position: 'relative' },
  discoveryDeckSection: { gap: 10 },
  discoveryDetailsContent: { gap: 13, padding: 18, paddingTop: 12 },
  discoveryDetailsHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 11 },
  discoveryDetailsScore: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 15, minWidth: 62, padding: 9 },
  discoveryDetailsScoreValue: { color: colors.primary, fontSize: 11, fontWeight: '700', textAlign: 'center' },
  discoveryDetailsSheet: { backgroundColor: '#ffffff', borderRadius: 24, maxHeight: '92%', maxWidth: 600, overflow: 'hidden', width: '100%' },
  discoveryDetailsTitleBlock: { flex: 1, gap: 3 },
  discoveryEmpty: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 22, borderWidth: 1, gap: 9, padding: 28 },
  discoveryEmptyIcon: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 99, height: 58, justifyContent: 'center', width: 58 },
  discoveryEmptyTitle: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  discoveryGameTitle: { color: '#ffffff', fontSize: 40, fontWeight: '700', letterSpacing: -1.1, lineHeight: 44, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 22 },
  discoveryHeroBottom: { gap: 3 },
  discoveryLocation: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '600' },
  discoveryMetric: { alignItems: 'center', flex: 1, gap: 1 },
  discoveryMetricLabel: { color: 'rgba(255,255,255,0.38)', fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  discoveryMetricValue: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  discoveryMetrics: { flexDirection: 'row', justifyContent: 'space-between' },
  discoveryNotice: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  discoveryNoticeText: { color: colors.primaryDark, flex: 1, fontSize: 11, fontWeight: '700' },
  discoveryProgressFill: { backgroundColor: colors.primary, borderRadius: 99, height: 4 },
  discoveryProgressRow: { alignItems: 'center', flexDirection: 'row', gap: 9, paddingHorizontal: 4 },
  discoveryProgressText: { color: '#c5d0e8', fontSize: 11, fontWeight: '700' },
  discoveryProgressTrack: { backgroundColor: '#202c47', borderRadius: 99, flex: 1, height: 4, overflow: 'hidden' },
  discoveryQuickFilter: { backgroundColor: '#16213a', borderColor: 'rgba(77,124,254,0.17)', borderRadius: 999, borderWidth: 1, minWidth: 55, paddingHorizontal: 14, paddingVertical: 8 },
  discoveryQuickFilterActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  discoveryQuickFilterText: { color: '#8899bb', fontSize: 11, fontWeight: '700' },
  discoveryQuickFilterTextActive: { color: '#ffffff' },
  discoveryQuickFilters: { gap: 8, paddingHorizontal: 1, paddingVertical: 2 },
  discoveryResetButton: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 11, flexDirection: 'row', gap: 7, marginTop: 5, minHeight: 42, paddingHorizontal: 15 },
  discoveryResetText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  discoverySavedCount: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  discoverySearchBackdrop: { alignItems: 'center', backgroundColor: 'rgba(2,6,18,0.72)', flex: 1, justifyContent: 'flex-start', paddingHorizontal: 18, paddingTop: Platform.OS === 'ios' ? 86 : 64 },
  discoverySearchClose: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  discoverySearchDone: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 13, justifyContent: 'center', minHeight: 48 },
  discoverySearchDoneText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  discoverySearchHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  discoverySearchInput: { color: '#ffffff', flex: 1, fontSize: 15, fontWeight: '700', minHeight: 50, paddingVertical: 0 },
  discoverySearchInputShell: { alignItems: 'center', backgroundColor: '#0a1120', borderColor: 'rgba(91,134,255,0.28)', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 52, paddingHorizontal: 13 },
  discoverySearchPopup: { backgroundColor: '#10192c', borderColor: 'rgba(91,134,255,0.26)', borderRadius: 22, borderWidth: 1, gap: 15, maxWidth: 600, padding: 17, shadowColor: '#000000', shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.42, shadowRadius: 32, width: '100%' },
  discoverySearchTitle: { color: '#f4f7ff', fontSize: 18, fontWeight: '700' },
  discoveryToolbar: { flexDirection: 'row', gap: 9 },
  discoveryToolbarButton: { alignItems: 'center', backgroundColor: '#16213a', borderColor: 'rgba(77,124,254,0.20)', borderRadius: 13, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 46, paddingHorizontal: 14 },
  discoveryToolbarButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  discoveryToolbarText: { color: '#9aabd0', fontSize: 12, fontWeight: '700', maxWidth: 150 },
  discoveryToolbarTextActive: { color: '#ffffff' },
  favoriteBadge: {
    alignItems: 'center',
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  favoriteBadgeText: {
    color: colors.amber,
    fontSize: 11,
    fontWeight: '700'
  },
  feeInfoBand: {
    alignItems: 'center',
    backgroundColor: '#fff8e8',
    borderColor: '#f0ddad',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  feeInfoText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16
  },
  feeTypePill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4
  },
  feeTypePillText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700'
  },
  feedAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  feedAvatarText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '700'
  },
  filterGrid: {
    gap: 10
  },
  fitBreakdown: { backgroundColor: '#f8fafc', borderColor: colors.line, borderRadius: 14, borderWidth: 1, gap: 10, padding: 13 },
  gameActionRow: {
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'flex-end'
  },
  gameCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  gameDetailsBack: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 44, paddingRight: 12 },
  gameDetailsBackText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  gameDetailsClub: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  gameDetailsFacts: { gap: 12 },
  gameDetailsHero: { borderRadius: 25, height: 330, justifyContent: 'space-between', overflow: 'hidden', padding: 20 },
  gameDetailsHeroCopy: { gap: 4 },
  gameDetailsHeroTop: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  gameDetailsLivePill: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 11, paddingVertical: 7 },
  gameDetailsLiveText: { color: colors.ink, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  gameDetailsLocation: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: '700' },
  gameDetailsNav: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
  gameDetailsPage: { gap: 13, paddingBottom: 18 },
  gameDetailsReason: { color: colors.muted, fontSize: 13, fontWeight: '600', lineHeight: 19 },
  gameDetailsScore: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 18, minWidth: 68, paddingHorizontal: 10, paddingVertical: 8 },
  gameDetailsScoreValue: { color: colors.primaryDark, fontSize: 11, fontWeight: '700', lineHeight: 14, textAlign: 'center' },
  gameDetailsSection: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 17, borderWidth: 1, gap: 12, padding: 15 },
  gameDetailsSectionHeading: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  gameDetailsSectionIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 34, justifyContent: 'center', width: 34 },
  gameDetailsSectionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  gameDetailsStatus: { color: '#bfdbfe', fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  gameDetailsTitle: { color: '#ffffff', fontSize: 38, fontWeight: '700', letterSpacing: -1, lineHeight: 42 },
  gameHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between'
  },
  gameTitleBlock: {
    flex: 1,
    gap: 4
  },
  hostPromptCard: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  hostPromptCopy: {
    flex: 1,
    gap: 1
  },
  hostPromptIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34
  },
  liveDot: { backgroundColor: '#4ade80', borderRadius: 99, height: 7, width: 7 },
  liveDotWarm: { backgroundColor: '#fbbf24' },
  liveStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 6, marginBottom: 2 },
  liveStatusText: { color: 'rgba(255,255,255,0.86)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  lockedFilterRow: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 11
  },
  lockedFilterRowActive: {
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.24)'
  },
  lockedFilterText: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: '700'
  },
  lockedRecommendationBand: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 11
  },
  lockedRecommendationText: {
    color: colors.muted,
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  mapCanvasLarge: {
    aspectRatio: 1.15,
    backgroundColor: colors.tealSoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative'
  },
  myGameActions: { flexDirection: 'row', gap: 8 },
  myGameCard: { backgroundColor: '#ffffff', borderColor: 'rgba(77,124,254,0.20)', borderRadius: 17, borderWidth: 1, gap: 11, padding: 14, width: 286 },
  myGameCardCopy: { flex: 1, gap: 2 },
  myGameCardHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  myGameMerchantNote: { color: colors.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  myGamePrimaryAction: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 10, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 42, paddingHorizontal: 11 },
  myGamePrimaryActionText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  myGameSecondaryAction: { alignItems: 'center', borderColor: colors.line, borderRadius: 10, borderWidth: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: 13 },
  myGameSecondaryActionText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  myGameStatusBand: { backgroundColor: '#f7f8ff', borderRadius: 11, gap: 3, padding: 10 },
  myGameStatusDetail: { color: colors.muted, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  myGameStatusIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  myGameStatusLabel: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  myGamesCount: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: 999, height: 28, justifyContent: 'center', minWidth: 28, paddingHorizontal: 8 },
  myGamesCountText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  myGamesRail: { gap: 11, paddingBottom: 3, paddingRight: 2 },
  myGamesSection: { gap: 10 },
  notificationPromise: { alignItems: 'flex-start', backgroundColor: '#edf7f5', borderColor: '#b9d9d3', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 13 },
  notificationPromiseCopy: { flex: 1, gap: 3 },
  notificationPromiseIcon: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 10, height: 36, justifyContent: 'center', width: 36 },
  offeredGameBand: {
    alignItems: 'flex-start',
    backgroundColor: '#eef4ff',
    borderColor: '#cbdafc',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10
  },
  offeredGameText: {
    color: colors.primaryDark,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  openPill: {
    backgroundColor: colors.tealSoft
  },
  paywallHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11
  },
  paywallIcon: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.15)',
    borderRadius: 999,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  paywallPanel: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  preferenceBand: {
    alignItems: 'center',
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 12
  },
  preferenceText: {
    color: colors.teal,
    flex: 1,
    fontSize: 13,
    fontWeight: '700'
  },
  priceRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8
  },
  priceText: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700'
  },
  privateBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5
  },
  privateBadgeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700'
  },
  privateGameCard: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(15,118,110,0.18)'
  },
  privateGameComposer: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  privateGameMarker: {
    alignItems: 'center',
    borderColor: colors.teal,
    borderRadius: 999,
    borderWidth: 2,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  privateGameMarkerInner: {
    backgroundColor: colors.teal,
    borderRadius: 999,
    height: 16,
    width: 16
  },
  publishPrivateGame: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 13
  },
  publishPrivateGameDisabled: {
    backgroundColor: '#9aa3a0'
  },
  publishPrivateGameText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700'
  },
  rakeTypePill: {
    backgroundColor: '#fff0dc'
  },
  rakeTypePillText: {
    color: colors.amber
  },
  recommendationBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 5
  },
  recommendationBadgeText: {
    color: colors.teal,
    fontSize: 12,
    fontWeight: '700'
  },
  recommendationBand: {
    backgroundColor: '#f4fbf8',
    borderColor: 'rgba(21,127,109,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    gap: 7,
    padding: 11
  },
  recommendationText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18
  },
  savedGameCopy: { flex: 1, gap: 2 },
  savedGameRow: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 11 },
  savedGameScore: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 11, justifyContent: 'center', minHeight: 44, paddingHorizontal: 8, width: 62 },
  savedGameScoreValue: { color: colors.teal, fontSize: 10, fontWeight: '700', textAlign: 'center' },
  savedGamesHeader: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  savedGamesSection: { gap: 8 },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#d1d5db', borderRadius: 99, height: 4, marginTop: 9, width: 44 },
  storeButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, flexDirection: 'row', gap: 9, minHeight: 52, paddingHorizontal: 12 },
  storeButtonCopy: { flex: 1, gap: 1 },
  storeButtonText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  swipeFeedback: { alignItems: 'center', bottom: 0, justifyContent: 'center', left: 0, position: 'absolute', right: 0, top: 0, zIndex: 10 },
  swipeFeedbackPass: { backgroundColor: 'transparent' },
  swipeFeedbackPick: { backgroundColor: 'transparent' },
  swipeStamp: { backgroundColor: 'rgba(5,10,20,0.58)', borderRadius: 8, borderWidth: 3, paddingHorizontal: 11, paddingVertical: 7, position: 'absolute', top: 42, zIndex: 9 },
  swipeStampPass: { borderColor: '#ef4444', left: 24, transform: [{ rotate: '-10deg' }] },
  swipeStampPick: { borderColor: '#22c55e', right: 24, transform: [{ rotate: '10deg' }] },
  swipeStampText: { fontSize: 22, fontWeight: '700', letterSpacing: 1.4 },
  swipeStampTextPass: { color: '#ef4444' },
  swipeStampTextPick: { color: '#22c55e' },
  tableName: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700'
  },
  tableRow: {
    alignItems: 'center',
    backgroundColor: '#f7f7f4',
    borderColor: 'rgba(24,23,22,0.07)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 11
  },
  tableSeats: {
    color: colors.teal,
    fontSize: 22,
    fontWeight: '700'
  },
  valuePill: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: 'rgba(24,23,22,0.06)',
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  valuePillText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700'
  },
  valueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7
  },
  venueTypeBadge: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.20)', borderRadius: 999, borderWidth: 1, flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingVertical: 7 },
  venueTypeText: { color: '#ffffff', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  waitlistAheadBand: {
    alignItems: 'center',
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 9
  },
  waitlistAheadText: {
    color: colors.amber,
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16
  },
  waitlistPill: {
    backgroundColor: '#fff8ed',
    borderColor: 'rgba(181,106,24,0.18)'
  },
  waitlistPillText: {
    color: colors.amber
  }
}));
