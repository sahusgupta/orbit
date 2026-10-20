import { createContext, useContext, useMemo, useSyncExternalStore, type PropsWithChildren } from 'react';
import { Appearance, type ImageStyle, type TextStyle, type ViewStyle } from 'react-native';
import { colors as darkColors } from './playerTheme';

export type PlayerScheme = 'light' | 'dark';
export type PlayerPalette = { [Key in keyof typeof darkColors]: string } & { onPrimary: string; backdrop: string };
export const playerPalettes: Record<PlayerScheme, PlayerPalette> = {
  dark: { ...darkColors, onPrimary: darkColors.primaryDark, backdrop: 'rgba(0,0,0,0.62)' },
  light: { ink: '#14223a', muted: '#53617a', canvas: '#f4f7fc', panel: '#ffffff', line: '#cbd5e1', primary: '#2453ce',
    primaryDark: '#ffffff', primarySoft: '#e7edff', teal: '#08745d', tealSoft: '#e5f6f0', amber: '#6240ab', amberSoft: '#f0eaff',
    coral: '#a51d43', onPrimary: '#ffffff', backdrop: 'rgba(10,20,38,0.48)' }
};
type PlayerTheme = { scheme: PlayerScheme; colors: PlayerPalette; statusBarStyle: 'light' | 'dark' };
const darkTheme: PlayerTheme = { scheme: 'dark', colors: playerPalettes.dark, statusBarStyle: 'light' };
const ThemeContext = createContext<PlayerTheme>(darkTheme);
const readSystemScheme = (): PlayerScheme => Appearance?.getColorScheme?.() === 'light' ? 'light' : 'dark';
const subscribeToSystemScheme = (changed: () => void) => {
  const subscription = Appearance?.addChangeListener?.(changed);
  return () => subscription?.remove();
};

/** The application follows the OS. Standalone characterization components retain dark defaults. */
export function PlayerThemeProvider({ children }: PropsWithChildren) {
  const scheme = useSyncExternalStore<PlayerScheme>(subscribeToSystemScheme, readSystemScheme, () => 'dark');
  const theme = useMemo<PlayerTheme>(() => ({ scheme, colors: playerPalettes[scheme], statusBarStyle: scheme === 'dark' ? 'light' : 'dark' }), [scheme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
export function usePlayerTheme() { return useContext(ThemeContext); }

type PlayerStyle = ViewStyle | TextStyle | ImageStyle;
type PlayerStyles = Record<string, PlayerStyle>;
const colorProperties = ['color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor', 'shadowColor', 'tintColor', 'textDecorationColor'] as const;
const onPrimaryStyles = new Set(['primaryText', 'primaryButtonText', 'distanceChipTextActive', 'filterSheetDoneText', 'attendanceChoiceTextActive',
  'discoveryQuickFilterTextActive', 'discoveryToolbarTextActive', 'discoverySearchDoneText', 'myGamePrimaryActionText', 'myGamesCountText', 'onboardingNextActionText']);
const fixedWhiteStyles = new Set(['cameraCaption', 'cameraGuide', 'iconTooltipText', 'qrActionText']);
const lightSurfaces: Record<string, keyof PlayerPalette> = {
  '#0d1628': 'canvas', '#151f34': 'panel', '#121c30': 'panel', '#141e31': 'panel', '#172136': 'panel',
  '#10211f': 'tealSoft', '#172d30': 'tealSoft', '#142f31': 'tealSoft', '#142b43': 'primarySoft', '#142039': 'primarySoft',
  '#162541': 'primarySoft', '#18233a': 'primarySoft', '#291d45': 'amberSoft', '#2a201b': 'amberSoft', '#2a2119': 'amberSoft',
  '#2a2117': 'amberSoft', '#2b2117': 'amberSoft', '#0a1120': 'panel', '#0b1325': 'panel', '#0b1428': 'panel'
};
const lightForegrounds: Record<string, keyof PlayerPalette> = {
  '#eef3ff': 'ink', '#e6ecfa': 'ink', '#c4cee3': 'muted', '#aab8d2': 'muted', '#9aabd0': 'muted', '#64748b': 'muted',
  '#ffffff': 'ink', '#fff': 'ink', '#0b1020': 'ink', '#111827': 'ink', '#1f2937': 'ink', '#334155': 'ink', '#475569': 'muted', '#bfdbfe': 'primary'
};

function themedColor(value: string, property: typeof colorProperties[number], styleName: string, scheme: PlayerScheme): string {
  const palette = playerPalettes[scheme];
  const normalized = value.toLowerCase();
  if (styleName === 'membershipQrCode') return value; // A scannable QR always stays dark ink on white.
  if (styleName.startsWith('camera') || styleName === 'qrActionButton' || styleName === 'iconTooltip') return value;
  if (property === 'backgroundColor' && styleName === 'discoveryToolbarButton') return palette.panel;
  if (property === 'backgroundColor' && styleName === 'myGameStatusBand') return palette.primarySoft;
  if (property === 'color' && scheme === 'dark' && ['activeTabText', 'clubAvatarText', 'membershipProfileAvatarText'].includes(styleName)) return palette.ink;
  if (property === 'color' && onPrimaryStyles.has(styleName)) return palette.onPrimary;
  if (property === 'backgroundColor' && styleName === 'onboardingProgressFill') return palette.primary;
  if (property === 'color' && normalized === darkColors.primaryDark) return palette.ink;
  if (property === 'color' && styleName === 'membershipQrTitle') return palette.ink;
  if (fixedWhiteStyles.has(styleName)) return value;
  if (scheme === 'dark') return value;
  if (property === 'shadowColor') return '#14223a';
  if (property === 'backgroundColor' && /backdrop|overlay|dismiss/i.test(styleName)) return palette.backdrop;
  for (const key of Object.keys(darkColors) as Array<keyof typeof darkColors>) {
    if (normalized === darkColors[key].toLowerCase()) return palette[key];
  }
  if (property === 'backgroundColor') {
    if (lightSurfaces[normalized]) return palette[lightSurfaces[normalized]];
    if (normalized === '#ffffff' || normalized === '#fff') return palette.panel;
    if (normalized === '#111827' || normalized === '#0b1020') return palette.panel;
    if (/^rgba\(255,\s*255,\s*255,/.test(normalized)) return palette.primarySoft;
  } else if (property === 'color' || property === 'tintColor') {
    if (lightForegrounds[normalized]) return palette[lightForegrounds[normalized]];
    if (/^rgba\(255,\s*255,\s*255,/.test(normalized)) return palette.muted;
  } else if (/^rgba\(/.test(normalized)) return palette.line;
  return value;
}

/** Clone only color properties. Layout, dynamic values, public style shapes and the source stay intact. */
export function resolvePlayerStyles<T extends PlayerStyles>(definitions: T, scheme: PlayerScheme): T {
  const result = { ...definitions };
  for (const key in definitions) {
    const style = Object.assign({}, definitions[key]);
    for (const property of colorProperties) {
      const value: unknown = Reflect.get(style, property);
      if (typeof value === 'string') Reflect.set(style, property, themedColor(value, property, key, scheme));
    }
    result[key] = style;
  }
  return result;
}
export function useThemedStyles<T extends PlayerStyles>(definitions: T): T {
  const { scheme } = usePlayerTheme();
  return useMemo(() => resolvePlayerStyles(definitions, scheme), [definitions, scheme]);
}
