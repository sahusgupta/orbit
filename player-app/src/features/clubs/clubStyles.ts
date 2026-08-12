import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from '../../styles/playerTheme';

export const clubStyles = StyleSheet.create(applyDarkComponentTheme({
  attendanceChoice: { backgroundColor: '#f8fafc', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flex: 1, gap: 5, minHeight: 108, padding: 14 },
  attendanceChoiceActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  attendanceChoiceBody: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  attendanceChoiceRow: { flexDirection: 'row', gap: 10 },
  attendanceChoiceTextActive: { color: '#ffffff' },
  attendanceChoiceTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  buyAnotherPassButton: { alignItems: 'center', backgroundColor: colors.primaryDark, borderRadius: 11, minHeight: 42, justifyContent: 'center', paddingHorizontal: 14 },
  buyAnotherPassText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  checkedInBand: { alignItems: 'center', backgroundColor: 'rgba(74,222,128,0.12)', borderRadius: 10, flexDirection: 'row', gap: 7, padding: 9 },
  checkedInText: { color: '#dcfce7', flex: 1, fontSize: 10, fontWeight: '700' },
  clubAvatarActive: {
    backgroundColor: colors.primary
  },
  clubAvatarTextActive: {
    color: '#ffffff'
  },
  clubGameGroupLabel: { color: colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 1.15, marginBottom: 2 },
  clubHub: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  clubHubCopy: { flex: 1, gap: 2 },
  clubHubIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 38, justifyContent: 'center', width: 38 },
  clubHubPanel: { backgroundColor: '#f8fafc', borderBottomColor: colors.line, borderBottomWidth: 1, gap: 8, padding: 11 },
  clubHubRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 11, minHeight: 66, paddingHorizontal: 13 },
  clubRequestHeader: { gap: 3, marginTop: 8 },
  compactEventRow: { backgroundColor: '#ffffff', borderRadius: 11, minHeight: 52, padding: 11 },
  compactGameAction: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  compactGameActionMuted: { color: colors.muted },
  compactGameCopy: { flex: 1, gap: 2 },
  compactGameRow: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 11, flexDirection: 'row', minHeight: 52, paddingHorizontal: 11 },
  compactManageButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, justifyContent: 'center', minHeight: 40 },
  compactManageText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  compactStatLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: 2, textAlign: 'center' },
  compactStatValue: { color: colors.ink, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  formError: { color: '#b42318', fontSize: 12, fontWeight: '700' },
  inputLabel: { color: colors.ink, fontSize: 12, fontWeight: '700' },
  loyaltyBadge: {
    backgroundColor: colors.tealSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  loyaltyBadgeText: {
    color: colors.teal,
    fontWeight: '700'
  },
  loyaltyCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16
  },
  loyaltyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between'
  },
  membershipApplicationCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 11,
    padding: 14
  },
  membershipApplicationStatus: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 14 },
  membershipApplicationStatusCopy: { flex: 1, gap: 3 },
  membershipApplicationStatusIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 42, justifyContent: 'center', width: 42 },
  membershipCompactStats: { backgroundColor: '#ffffff', borderRadius: 11, flexDirection: 'row', justifyContent: 'space-around', padding: 11 },
  membershipHero: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 13,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.03,
    shadowRadius: 12
  },
  membershipHeroCopy: {
    flex: 1,
    gap: 5
  },
  membershipHeroIcon: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 14,
    height: 52,
    justifyContent: 'center',
    width: 52
  },
  membershipHeroText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700'
  },
  membershipIdentityLabel: { color: 'rgba(255,255,255,0.55)', fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  membershipIdentityRow: { flexDirection: 'row', justifyContent: 'space-between' },
  membershipIdentityValue: { color: '#ffffff', fontSize: 13, fontWeight: '700', marginTop: 3 },
  membershipNumberBlock: { alignItems: 'flex-end' },
  membershipProfileAvatar: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 10, height: 40, justifyContent: 'center', width: 40 },
  membershipProfileAvatarText: { color: colors.primary, fontSize: 17, fontWeight: '700' },
  membershipProfileCopy: { flex: 1, gap: 2 },
  membershipProfileSummary: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 11 },
  membershipQrCode: { alignItems: 'center', backgroundColor: '#ffffff', height: 150, justifyContent: 'center', width: 150 },
  membershipQrCopy: { flex: 1, gap: 5 },
  membershipQrMember: { color: '#64748b', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  membershipQrShell: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 16, flexDirection: 'row', gap: 15, padding: 12 },
  membershipQrTitle: { color: '#0f172a', fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  membershipScreen: {
    gap: 12
  },
  membershipStatusBadge: { alignItems: 'center', backgroundColor: 'rgba(74,222,128,0.16)', borderRadius: 99, flexDirection: 'row', gap: 5, paddingHorizontal: 9, paddingVertical: 6 },
  membershipStatusBadgeInactive: { backgroundColor: 'rgba(251,191,36,0.16)' },
  membershipStatusDot: { backgroundColor: '#4ade80', borderRadius: 99, height: 6, width: 6 },
  membershipStatusDotInactive: { backgroundColor: '#fbbf24' },
  membershipStatusText: { color: '#ffffff', fontSize: 9, fontWeight: '700', letterSpacing: 0.7 },
  membershipWalletBrand: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  membershipWalletCard: { borderRadius: 22, gap: 15, overflow: 'hidden', padding: 17, shadowColor: '#0f172a', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.18, shadowRadius: 28 },
  membershipWalletClub: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  membershipWalletMonogram: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.16)', borderColor: 'rgba(255,255,255,0.22)', borderRadius: 12, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 },
  membershipWalletMonogramText: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  membershipWalletPlan: { color: 'rgba(255,255,255,0.65)', fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  membershipWalletTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  merchantBand: { alignItems: 'flex-start', backgroundColor: colors.tealSoft, borderColor: 'rgba(21,127,109,0.20)', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 9, padding: 12 },
  merchantBandText: { color: colors.teal, flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  passTimer: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 13 },
  passTimerActive: { backgroundColor: colors.tealSoft, borderColor: 'rgba(21,127,109,0.20)' },
  passTimerCopy: { flex: 1, gap: 2 },
  passTimerInactive: { backgroundColor: '#f4f4f1', borderColor: colors.line },
  passTimerTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  payInPersonButton: { alignItems: 'center', backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 12, padding: 15 },
  payInPersonCopy: { flex: 1, gap: 2 },
  paymentPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#fbfffc',
    borderColor: colors.line,
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    gap: 10,
    minHeight: 220,
    justifyContent: 'center',
    padding: 20
  },
  paymentPlaceholderIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 16,
    height: 56,
    justifyContent: 'center',
    width: 56
  },
  planCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 11,
    minHeight: 72,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  planCardCopy: { flex: 1, gap: 3 },
  planCardFeatured: {
    backgroundColor: '#f4fbf8',
    borderColor: 'rgba(21,127,109,0.24)'
  },
  planCardPriceBlock: { alignItems: 'flex-end', flexDirection: 'row', gap: 4 },
  planCompactPrice: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  planGrid: {
    gap: 10
  },
  planIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  points: {
    color: colors.ink,
    fontSize: 34,
    fontWeight: '700'
  },
  requestGameRow: { backgroundColor: '#f1f7f6', borderColor: 'rgba(15,118,110,0.18)', borderWidth: 1 },
  seatRequestHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 12 },
  seatRequestHeaderCopy: { flex: 1, gap: 5 },
  seatRequestModal: {
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 20,
    borderWidth: 1,
    gap: 16,
    maxWidth: 540,
    padding: 20,
    width: '100%'
  },
  seatTimeField: { gap: 7 },
  seatTimeInput: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 11, borderWidth: 1, color: colors.ink, fontSize: 15, minHeight: 46, paddingHorizontal: 12 },
  selectedCard: {
    backgroundColor: '#fbfffc',
    borderColor: 'rgba(21,127,109,0.26)'
  },
  timeRangeInput: { flex: 1 },
  timeRangeRow: { flexDirection: 'row', gap: 8 }
}));
