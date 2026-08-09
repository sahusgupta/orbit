import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from './playerTheme';

export const notificationStyles = StyleSheet.create(applyDarkComponentTheme({
  alertToastHost: { left: 14, position: 'absolute', right: 14, top: 58, zIndex: 200 },
  alertPopup: { alignItems: 'flex-start', backgroundColor: colors.panel, borderColor: colors.line, borderRadius: 16, borderWidth: 1, elevation: 12, flexDirection: 'row', gap: 11, padding: 14, shadowColor: '#000000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.28, shadowRadius: 24 },
  alertPopupIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 40, justifyContent: 'center', width: 40 },
  alertPopupCopy: { flex: 1, gap: 3, paddingTop: 1 },
  alertPopupTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  alertPopupBody: { color: colors.muted, fontSize: 12, fontWeight: '600', lineHeight: 17 },
  alertPopupClose: { alignItems: 'center', height: 32, justifyContent: 'center', marginRight: -5, marginTop: -5, width: 32 }
}));
