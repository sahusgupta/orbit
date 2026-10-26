import { StyleSheet } from 'react-native';
import { usePlayerTheme, type PlayerScheme } from '../../styles/PlayerThemeProvider';

const palettes = {
  dark: {
    canvas: '#0B0D10', panel: '#14191F', ink: '#F5F2EB', muted: '#B7B4AE',
    line: '#34363A', accent: '#F0D394', accentSoft: '#302A1E', onAccent: '#181713'
  },
  light: {
    canvas: '#F7F5F0', panel: '#FFFEFB', ink: '#252924', muted: '#62665F',
    line: '#DED8CD', accent: '#76561D', accentSoft: '#F0E6D0', onAccent: '#FFFEFB'
  }
};

export function getMembershipPalette(scheme: PlayerScheme) { return palettes[scheme]; }
export function useMembershipPalette() { return getMembershipPalette(usePlayerTheme().scheme); }

export const membershipPresentation = StyleSheet.create({
  screen: { flexGrow: 1, gap: 24, paddingTop: 4, paddingBottom: 12 },
  intro: { gap: 8 },
  heading: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 21 },
  section: { gap: 16 },
  sectionHeading: { fontSize: 18, lineHeight: 25, fontWeight: '600' },
  back: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingRight: 16 },
  backText: { fontSize: 15, fontWeight: '600' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 },
  detailLabel: { flex: 1, fontSize: 13, lineHeight: 20 },
  detailValue: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '600', textAlign: 'right' },
  rule: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 16 },
  note: { borderLeftWidth: 2, paddingLeft: 14, gap: 6 },
  footer: { gap: 10, marginTop: 'auto', paddingTop: 8 },
  action: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10, minHeight: 50, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12 },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  checkIn: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 14 },
  statusBand: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusCopy: { flex: 1, gap: 6 }
});
