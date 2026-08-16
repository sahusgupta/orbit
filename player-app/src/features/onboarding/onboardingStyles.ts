import { StyleSheet } from 'react-native';
import { applyDarkComponentTheme, colors } from '../../styles/playerTheme';

export const onboardingStyles = StyleSheet.create(applyDarkComponentTheme({
  onboardingSafeArea: {
    backgroundColor: '#0b1020'
  },
  onboardingShell: {
    flex: 1,
    paddingHorizontal: 24
  },
  onboardingContent: {
    flexGrow: 1,
    justifyContent: 'center',
    minHeight: '100%',
    paddingBottom: 34,
    paddingTop: 22
  },
  animatedGradientRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.canvas,
    overflow: 'hidden'
  },
  arrowAction: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    minWidth: 44,
    position: 'relative'
  },
  arrowActionDisabled: {
    opacity: 0.35
  },
  gradientShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6,12,26,0.18)'
  },
  onboardingActions: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2
  },
  onboardingBrand: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2
  },
  onboardingBrandSubtle: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.6,
    textTransform: 'uppercase'
  },
  onboardingFlow: {
    flex: 1,
    gap: 26,
    justifyContent: 'center',
    minHeight: '100%'
  },
  onboardingNextAction: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderColor: 'rgba(255,255,255,0.36)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 142,
    paddingHorizontal: 18
  },
  onboardingNextActionText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700'
  },
  onboardingProgressFill: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    height: 3
  },
  onboardingProgressShell: {
    flex: 1,
    maxWidth: 168
  },
  onboardingProgressTrack: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: 6,
    height: 3,
    overflow: 'hidden'
  },
  onboardingStepSurface: {
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    borderRadius: 0,
    gap: 12,
    minHeight: 86,
    paddingHorizontal: 0,
    paddingVertical: 0
  },
  onboardingTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 38,
    textAlign: 'center'
  },
  onboardingTopBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    position: 'absolute',
    top: 0,
    width: '100%'
  },
  optionalStep: {
    gap: 10
  },
  optionalStepText: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    textAlign: 'center'
  },
  orbitHalo: {
    borderColor: 'rgba(110,145,255,0.28)',
    borderRadius: 999,
    borderWidth: 2,
    height: 260,
    left: -48,
    position: 'absolute',
    top: 92,
    transform: [{ rotate: '-18deg' }],
    width: 420
  },
  orbitNode: {
    backgroundColor: '#8ca7ff',
    borderColor: 'rgba(77,124,254,0.32)',
    borderRadius: 999,
    borderWidth: 3,
    height: 28,
    position: 'absolute',
    width: 28
  },
  orbitNodeFour: {
    bottom: 34,
    right: 118
  },
  orbitNodeOne: {
    left: 86,
    top: 18
  },
  orbitNodeThree: {
    bottom: 22,
    left: 132
  },
  orbitNodeTwo: {
    right: 88,
    top: 34
  },
  orbitPattern: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.28
  },
  orbitRing: {
    borderColor: 'rgba(53,211,161,0.28)',
    borderRadius: 999,
    borderWidth: 14,
    bottom: 28,
    left: 34,
    position: 'absolute',
    right: 34,
    top: 28
  },
  stepHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  stepHeaderIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderColor: 'rgba(21,127,109,0.11)',
    borderRadius: 10,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44
  },
  stepHeaderText: {
    flex: 1,
    gap: 4
  }
}));
