import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from '../../styles/playerTheme';

export const settingsStyles = StyleSheet.create(applyDarkComponentTheme({
  searchInputRow: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: 'rgba(24,23,22,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 12
  },
  googleAuthPanel: {
    alignItems: 'center',
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12
  },
  emailAuthPanel: {
    backgroundColor: '#f6f6f3',
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
    padding: 12
  },
  googleAuthIcon: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderRadius: 999,
    height: 40,
    justifyContent: 'center',
    width: 40
  },
  googleAuthBody: {
    flex: 1,
    gap: 3
  },
  identityCard: {
    alignSelf: 'center',
    marginTop: 18,
    maxWidth: 520,
    padding: 22,
    width: '100%'
  },
  identityIcon: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 68,
    justifyContent: 'center',
    width: 68
  },
  identityCopy: {
    alignItems: 'center',
    gap: 7
  },
  identityPrivacy: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center'
  },
  simpleMenu: { backgroundColor: '#ffffff', borderColor: colors.line, borderRadius: 16, borderWidth: 1, overflow: 'hidden' }
}));
