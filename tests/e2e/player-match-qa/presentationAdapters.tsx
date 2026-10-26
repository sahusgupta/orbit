import { Text, View, type ViewProps, type ViewStyle } from 'react-native';

// Only Expo font/gradient and unused QR presentation are replaced. Native Web controls remain real.
export function Ionicons({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  const symbols: Record<string, string> = { 'close-outline': '×', 'heart-outline': '♡', 'arrow-undo-outline': '↶',
    'information-circle-outline': 'ⓘ', 'chevron-down': '⌄', 'chevron-up': '⌃', 'arrow-back': '←', 'navigate-outline': '↗' };
  return <Text aria-hidden style={{ fontSize: size, color }}>{symbols[name] ?? '·'}</Text>;
}
export function LinearGradient({ children, style, colors = [], locations, start = { x: 0, y: 0 }, end = { x: 0, y: 1 }, ...props }: ViewProps & {
  colors?: readonly string[];
  locations?: readonly number[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}) {
  // React Native Web accepts backgroundImage and preserves native layout styles.
  const angle = Math.atan2(end.x - start.x, start.y - end.y) * 180 / Math.PI;
  const stops = colors.map((color, index) => `${color}${locations?.[index] == null ? '' : ` ${locations[index] * 100}%`}`);
  const gradient: ViewStyle & { backgroundImage: string } = { backgroundImage: colors.length > 1 ? `linear-gradient(${angle}deg, ${stops.join(', ')})` : 'none' };
  return <View {...props} style={[style, gradient]}>{children}</View>;
}
export default function UnusedQr() { throw new Error('QR issuance is outside the isolated Match harness.'); }
