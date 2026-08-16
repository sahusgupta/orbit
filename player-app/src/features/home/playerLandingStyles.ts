import { StyleSheet } from 'react-native';
import { colors } from '../../styles/playerTheme';

export const playerLandingStyles = StyleSheet.create({
  ambientFlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.9
  },
  landingHero: {
    gap: 20,
    marginBottom: 12,
    paddingBottom: 8
  },
  brandRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
    paddingTop: 6
  },
  brandMark: {
    alignItems: 'center',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 42
  },
  brandName: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 24
  },
  brandDescriptor: {
    color: '#7082a5',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  heroCopy: {
    alignItems: 'center',
    gap: 17,
    paddingHorizontal: 4,
    paddingVertical: 18
  },
  eyebrowRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7
  },
  eyebrow: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.85,
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 46,
    fontWeight: '700',
    letterSpacing: -1.8,
    lineHeight: 48,
    textAlign: 'center'
  },
  heroActions: {
    alignSelf: 'stretch',
    gap: 9
  },
  primaryAction: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600'
  },
  secondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: 'rgba(110,145,255,0.36)',
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16
  },
  secondaryActionText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600'
  },
  heroProof: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  liveDot: {
    backgroundColor: colors.teal,
    borderRadius: 99,
    height: 7,
    width: 7
  },
  heroProofText: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center'
  },
  atmosphere: {
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    height: 420,
    overflow: 'hidden',
    position: 'relative'
  },
  tableAtmosphere: {
    ...StyleSheet.absoluteFillObject
  },
  tableGradient: {
    ...StyleSheet.absoluteFillObject
  },
  cardShowcase: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 44
  },
  cardHand: {
    height: 190,
    position: 'relative',
    width: 254
  },
  pokerCard: {
    backgroundColor: '#f2eee6',
    borderColor: '#d8d0c3',
    borderRadius: 13,
    borderWidth: 1,
    height: 142,
    position: 'absolute',
    top: 24,
    width: 88
  },
  pokerCardActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: '#020612',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.42,
    shadowRadius: 24
  },
  cardCornerTop: {
    alignItems: 'center',
    left: 8,
    position: 'absolute',
    top: 7
  },
  cardCornerBottom: {
    alignItems: 'center',
    bottom: 7,
    position: 'absolute',
    right: 8,
    transform: [{ rotate: '180deg' }]
  },
  cardRank: {
    color: '#121827',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 13
  },
  cardCornerSuit: {
    color: '#121827',
    fontFamily: 'serif',
    fontSize: 13,
    lineHeight: 14
  },
  cardSuit: {
    color: '#121827',
    fontFamily: 'serif',
    fontSize: 34,
    left: 0,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
    top: 47
  },
  cardRed: {
    color: '#be334b'
  },
  cardLabel: {
    bottom: 26,
    color: '#4c5361',
    fontSize: 9,
    fontWeight: '700',
    left: 0,
    letterSpacing: 0.7,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  cardReadout: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(13,21,37,0.94)',
    borderColor: 'rgba(110,145,255,0.36)',
    borderRadius: 12,
    borderWidth: 1,
    gap: 7,
    minHeight: 118,
    padding: 16
  },
  cardReadoutLabel: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.9,
    textTransform: 'uppercase'
  },
  cardReadoutTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700'
  },
  cardReadoutBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18
  },
  nowBoard: {
    alignSelf: 'center',
    backgroundColor: '#0d1525',
    borderColor: 'rgba(110,145,255,0.36)',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: -42,
    padding: 14,
    width: '94%'
  },
  nowBoardHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12
  },
  nowBoardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  nowBoardTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700'
  },
  quietAction: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 5
  },
  quietActionText: {
    color: '#9bb0ff',
    fontSize: 12,
    fontWeight: '600'
  },
  nowBoardList: {
    gap: 8,
    paddingTop: 10
  },
  liveGameRow: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 86,
    padding: 12
  },
  liveGameCopy: {
    flex: 1,
    gap: 3
  },
  liveGameStatusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5
  },
  liveGameStatusDot: {
    backgroundColor: colors.teal,
    borderRadius: 99,
    height: 6,
    width: 6
  },
  formingGameStatusDot: {
    backgroundColor: colors.primary
  },
  liveGameKicker: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '600'
  },
  liveGameTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700'
  },
  liveGameMeta: {
    color: colors.muted,
    fontSize: 11
  },
  liveGameFacts: {
    flexDirection: 'row',
    gap: 10
  },
  liveGameFactLabel: {
    color: colors.muted,
    fontSize: 8,
    fontWeight: '600',
    textTransform: 'uppercase'
  },
  liveGameFactValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '700'
  },
  nowBoardEmpty: {
    alignItems: 'flex-start',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    padding: 14
  },
  nowBoardEmptyCopy: {
    flex: 1,
    gap: 4
  },
  nowBoardEmptyTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700'
  },
  nowBoardEmptyText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  spotlightRow: {
    flexDirection: 'row',
    gap: 10
  },
  spotlightCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    gap: 6,
    minHeight: 174,
    padding: 14
  },
  spotlightIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  spotlightMonogram: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  spotlightMonogramText: {
    color: '#8ca7ff',
    fontSize: 15,
    fontWeight: '700'
  },
  spotlightEyebrow: {
    color: colors.teal,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.55,
    marginTop: 4,
    textTransform: 'uppercase'
  },
  spotlightTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 19
  },
  spotlightFooter: {
    alignItems: 'baseline',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingTop: 9
  },
  spotlightCount: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: '700'
  },
  spotlightMeta: {
    color: colors.muted,
    flex: 1,
    fontSize: 10,
    textTransform: 'uppercase'
  },
  journey: {
    backgroundColor: '#0d1525',
    borderColor: colors.line,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    marginVertical: 10,
    padding: 22
  },
  journeyEyebrow: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  journeyTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 29,
    textAlign: 'center'
  },
  journeyList: {
    marginTop: 12
  },
  journeyStep: {
    alignItems: 'center',
    borderTopColor: colors.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 15,
    minHeight: 78,
    paddingVertical: 14
  },
  journeyNumber: {
    color: '#8ca7ff',
    fontSize: 11,
    fontWeight: '600',
    width: 24
  },
  journeyCopy: {
    flex: 1,
    gap: 3
  },
  journeyStepTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700'
  },
  journeyStepBody: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17
  },
  faqSection: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 18,
    marginTop: 10,
    paddingTop: 22
  },
  faqIntro: {
    gap: 7
  },
  faqIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    marginBottom: 3,
    width: 44
  },
  faqEyebrow: {
    color: colors.teal,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase'
  },
  faqTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 29
  },
  faqList: {
    borderTopColor: colors.line,
    borderTopWidth: 1
  },
  faqItem: {
    borderBottomColor: colors.line,
    borderBottomWidth: 1
  },
  faqTrigger: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingVertical: 10
  },
  faqNumber: {
    color: '#6f91ff',
    fontSize: 10,
    fontWeight: '600',
    width: 24
  },
  faqQuestion: {
    color: colors.ink,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 19
  },
  faqAnswer: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
    paddingBottom: 17,
    paddingLeft: 34,
    paddingRight: 12
  },
  footer: {
    borderTopColor: colors.line,
    borderTopWidth: 1,
    gap: 14,
    marginTop: 10,
    paddingBottom: 4,
    paddingTop: 20
  },
  footerBrand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10
  },
  footerBrandCopy: {
    flex: 1,
    gap: 2
  },
  footerBrandName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700'
  },
  footerDeveloper: {
    color: colors.muted,
    fontSize: 11
  },
  footerRoutes: {
    color: '#7082a5',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.35
  }
});
