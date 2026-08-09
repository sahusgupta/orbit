import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from '../../styles/playerTheme';

export const tournamentStyles = StyleSheet.create(applyDarkComponentTheme({
  tournamentCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 18,
    borderWidth: 1,
    gap: 14,
    marginBottom: 14,
    padding: 18
  },
  tournamentCardFeatured: {
    borderColor: 'rgba(77,124,254,0.48)',
    borderWidth: 2
  },
  tournamentClosedPill: { backgroundColor: '#f1f2f4' },
  tournamentClubHeader: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,254,250,0.92)',
    borderColor: colors.line,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    paddingVertical: 12
  },
  tournamentClubSection: {
    gap: 10
  },
  tournamentConfirmation: { alignItems: 'center', backgroundColor: colors.tealSoft, borderRadius: 12, flexDirection: 'row', gap: 10, padding: 12 },
  tournamentIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 12, height: 44, justifyContent: 'center', width: 44 },
  tournamentMessage: { color: colors.primaryDark, fontSize: 12, fontWeight: '700' },
  tournamentMoneyGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  tournamentMoneyItem: {
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(77,124,254,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    gap: 4,
    minWidth: 130,
    padding: 11
  },
  tournamentMoneyItemWide: {
    flexBasis: '100%'
  },
  tournamentMoneyValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18
  },
  tournamentOpenPill: { backgroundColor: colors.tealSoft },
  tournamentPrize: { color: colors.primary, fontSize: 12, fontWeight: '900', letterSpacing: 0.8 },
  tournamentRule: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  tournamentRules: { gap: 6 },
  tournamentStatLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 2 },
  tournamentStatValue: { color: colors.ink, fontSize: 16, fontWeight: '900' },
  tournamentStats: { backgroundColor: '#f6f7fb', borderRadius: 14, flexDirection: 'row', justifyContent: 'space-between', padding: 14 },
  tournamentStructure: { gap: 5 },
  tournamentTitleRow: { alignItems: 'center', flexDirection: 'row', gap: 12 }
}));
