import { Platform, StyleSheet } from 'react-native';
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
    fontWeight: '700',
    textAlign: 'center'
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
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
    fontWeight: '700',
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
  },
  agentKicker: {
    color: colors.teal,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'uppercase'
  },
  animatedButtonShadow: {
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 14
  },
  buttonGradient: {
    alignItems: 'center',
    alignSelf: 'stretch',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 16
  },
  clubAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  clubAvatarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700'
  },
  clubCard: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 13,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.025,
    shadowRadius: 10
  },
  clubMain: {
    flex: 1,
    gap: 4
  },
  distanceChip: {
    alignItems: 'center',
    backgroundColor: '#f4f4f1',
    borderColor: colors.line,
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center'
  },
  distanceChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  distanceChipText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: '700'
  },
  distanceChipTextActive: {
    color: '#ffffff'
  },
  distanceRow: {
    flexDirection: 'row',
    gap: 7
  },
  emptyState: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    padding: 16
  },
  filterChipRow: {
    gap: 8,
    paddingRight: 8
  },
  filterPanel: {
    gap: 10
  },
  filterSheetBackdrop: {
    backgroundColor: 'rgba(15,23,42,0.38)',
    flex: 1,
    justifyContent: 'flex-end'
  },
  filterSheetCard: {
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    maxWidth: 640,
    overflow: 'hidden',
    paddingBottom: Platform.OS === 'ios' ? 20 : 12,
    width: '100%'
  },
  filterSheetContent: {
    gap: 16,
    padding: 16,
    paddingBottom: 22
  },
  filterSheetDismiss: {
    ...StyleSheet.absoluteFillObject
  },
  filterSheetDoneAction: {
    backgroundColor: colors.primary,
    borderRadius: 10
  },
  filterSheetDoneText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700'
  },
  filterSheetHandle: {
    alignSelf: 'center',
    backgroundColor: '#d1d5db',
    borderRadius: 99,
    height: 4,
    marginTop: 9,
    width: 42
  },
  filterSheetHeader: {
    alignItems: 'center',
    borderBottomColor: colors.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16
  },
  filterSheetHeaderAction: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 58,
    paddingHorizontal: 9
  },
  filterSheetResetText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '700'
  },
  filterSheetTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700'
  },
  fullWidthButton: {
    alignSelf: 'stretch'
  },
  iconActionButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(56,80,109,0.14)',
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42
  },
  iconActionButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  iconActionButtonDisabled: {
    backgroundColor: '#eeeeea',
    borderColor: colors.line
  },
  iconActionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  inlineBackAction: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexDirection: 'row',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: 2
  },
  inlineBackText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700'
  },
  membershipTitle: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.48)',
    flex: 1,
    justifyContent: 'center',
    padding: 18
  },
  modalCloseButton: { alignItems: 'center', backgroundColor: '#f3f4f6', borderRadius: 999, height: 36, justifyContent: 'center', width: 36 },
  plainFiltersButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 13
  },
  plainFiltersText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700'
  },
  plainSearchBar: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: colors.line,
    borderRadius: 13,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 13
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 46,
    overflow: 'hidden',
    paddingHorizontal: 0
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700'
  },
  privateGameStatus: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 2
  },
  searchInput: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    minHeight: 42,
    paddingVertical: 0
  },
  searchToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingTop: 2
  },
  sheetField: {
    gap: 8
  },
  sheetTextInput: {
    backgroundColor: '#f8fafc',
    borderColor: colors.line,
    borderRadius: 11,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 46,
    paddingHorizontal: 12
  },
  statusPill: {
    backgroundColor: colors.amberSoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  statusText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700'
  },
  compactButton: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  compactButtonText: {
    color: colors.ink,
    fontWeight: '700'
  },
  disabledAction: { opacity: 0.45 },
  secondaryActionButton: { alignItems: 'center', borderColor: colors.line, borderRadius: 10, borderWidth: 1, minHeight: 42, justifyContent: 'center' },
  secondaryActionText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700'
  },
  accountCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.025,
    shadowRadius: 12
  },
  simpleMenuCopy: { flex: 1, gap: 2 },
  simpleMenuIcon: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 11, height: 42, justifyContent: 'center', width: 42 },
  simpleMenuRow: { alignItems: 'center', borderBottomColor: colors.line, borderBottomWidth: 1, flexDirection: 'row', gap: 12, minHeight: 74, paddingHorizontal: 14 }
}));
