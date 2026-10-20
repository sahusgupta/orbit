import { Text, View, type ViewProps } from 'react-native';

// Only Expo font/gradient and unused QR presentation are replaced. Native Web controls remain real.
export function Ionicons({ name, size = 18, color }: { name: string; size?: number; color?: string }) {
  const symbols: Record<string, string> = { 'close-outline': '×', 'heart-outline': '♡', 'arrow-undo-outline': '↶',
    'information-circle-outline': 'ⓘ', 'chevron-down': '⌄', 'chevron-up': '⌃', 'arrow-back': '←', 'navigate-outline': '↗' };
  return <Text aria-hidden style={{ fontSize: size, color }}>{symbols[name] ?? '·'}</Text>;
}
export function LinearGradient({ children, style }: ViewProps & { colors?: string[]; start?: object; end?: object }) {
  return <View style={style}>{children}</View>;
}
export default function UnusedQr() { throw new Error('QR issuance is outside the isolated Match harness.'); }
