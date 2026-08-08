import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from './playerTheme';

export const sharedStyles = StyleSheet.create(applyDarkComponentTheme({
  safeArea: {
    flex: 1,
    backgroundColor: '#060c1a'
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  iconTooltip: {
    alignItems: 'center',
    backgroundColor: colors.primaryDark,
    borderRadius: 8,
    bottom: 48,
    maxWidth: 190,
    minWidth: 84,
    paddingHorizontal: 9,
    paddingVertical: 6,
    position: 'absolute',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.16,
    shadowRadius: 10,
    zIndex: 30
  },
  iconTooltipText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center'
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0
  },
  mapCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    overflow: 'hidden',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  mapCanvas: {
    aspectRatio: 1.55,
    backgroundColor: colors.tealSoft,
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative'
  },
  liveMap: {
    ...StyleSheet.absoluteFillObject
  },
  mapFooter: {
    gap: 3
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0
  },
  muted: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18
  },
  field: {
    gap: 6
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  },
  fieldLabelLight: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center'
  },
  input: {
    backgroundColor: '#f7f7f4',
    borderColor: 'rgba(24,23,22,0.08)',
    borderRadius: 10,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 44,
    paddingHorizontal: 12,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0,
    shadowRadius: 0
  },
  inputLight: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '600',
    minHeight: 58,
    paddingHorizontal: 16,
    textAlign: 'center'
  },
  inputError: {
    borderColor: '#f59e0b'
  },
  fieldError: {
    color: '#b45309',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17
  },
  fieldErrorLight: {
    color: '#fde68a',
    textAlign: 'center'
  },
  chip: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  chipActive: {
    backgroundColor: colors.tealSoft,
    borderColor: 'rgba(21,127,109,0.28)'
  },
  chipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  chipTextActive: {
    color: colors.primary
  }
}));
