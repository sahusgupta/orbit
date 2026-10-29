import { StyleSheet } from 'react-native';
import { colors, density, radii, spacing, typography } from '../../styles/playerTheme';

export const playerHomeStyles = StyleSheet.create({
  home: { flex: 1, gap: spacing[5] },
  findGames: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: colors.line,
    borderRadius: radii.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing[3],
    minHeight: 52,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3]
  },
  findGamesText: {
    color: colors.ink,
    flex: 1,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold
  },
  section: { flex: 1, gap: spacing[3] },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
    justifyContent: 'space-between'
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: typography.sizes.heading,
    fontWeight: typography.weights.semibold
  },
  statusNote: { color: colors.muted, fontSize: typography.sizes.label },
  gameList: {
    flex: 1,
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radii.panel,
    borderWidth: 1,
    overflow: 'hidden'
  },
  gameRow: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing[3],
    minHeight: 88,
    padding: spacing[4]
  },
  rowDivider: { borderTopColor: colors.line, borderTopWidth: 1 },
  gameCopy: { flex: 1, gap: spacing[1] },
  gameVisual: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 16, height: 52, justifyContent: 'center', width: 52 },
  gameName: {
    color: colors.ink,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold
  },
  venue: { color: colors.muted, fontSize: 13 },
  availability: { color: colors.ink, fontSize: typography.sizes.label, lineHeight: typography.lineHeights.compact },
  emptyState: { minHeight: 72, justifyContent: 'center', paddingVertical: spacing[3] },
  emptyText: { color: colors.muted, fontSize: typography.sizes.body, lineHeight: typography.lineHeights.body },
  shortcuts: { flexDirection: 'row', gap: spacing[3] },
  shortcut: {
    alignItems: 'center',
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: radii.control,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: spacing[2],
    minHeight: density.touchTarget,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  shortcutText: { color: colors.ink, flex: 1, fontSize: typography.sizes.body, fontWeight: typography.weights.medium },
  shortcutCount: { color: colors.muted, fontSize: typography.sizes.label },
  pressed: { opacity: 0.7 }
});
