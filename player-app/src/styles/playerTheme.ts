export const colors = {
  ink: '#f4f7ff',
  muted: '#8a9abd',
  canvas: '#060c1a',
  panel: '#10192c',
  line: 'rgba(110,145,255,0.18)',
  primary: '#4d7cfe',
  primaryDark: '#080f1f',
  primarySoft: '#182746',
  teal: '#35d3a1',
  tealSoft: '#102d2a',
  amber: '#a98bff',
  amberSoft: '#291d45',
  coral: '#fb7185'
};

export const typography = {
  family: 'system',
  weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  sizes: { meta: 11, label: 12, body: 15, heading: 18, display: 24 },
  lineHeights: { compact: 16, body: 21, heading: 25 }
} as const;

export const spacing = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32 } as const;
export const radii = { none: 0, small: 6, control: 10, panel: 12, overlay: 16, full: 999 } as const;
export const elevation = {
  none: { elevation: 0, shadowOpacity: 0 },
  overlay: { elevation: 12, shadowOpacity: 0.24, shadowRadius: 24 }
} as const;
export const motion = { fast: 120, base: 180, slow: 280 } as const;
export const density = { compactControl: 36, defaultControl: 42, touchTarget: 44 } as const;
export const iconSizes = { small: 16, medium: 20, large: 24 } as const;
export const breakpoints = { compact: 680, tablet: 900, wide: 1180 } as const;
export const layout = { reading: 720, compact: 920, wide: 1360 } as const;

export function applyDarkComponentTheme<T extends Record<string, unknown>>(definitions: T): T {
  const lightSurfaces: Record<string, string> = {
    '#ffffff': '#10192c',
    '#fff': '#10192c',
    '#f8fafc': '#0d1628',
    '#f9fafb': '#060c1a',
    '#f4f4f1': '#151f34',
    '#f6f6f3': '#121c30',
    '#fbfffc': '#10211f',
    '#fff7ed': '#2a201b',
    '#f3f4f6': '#18233a',
    '#eef3ff': '#182746',
    '#dbeafe': '#142b43',
    '#f3e8ff': '#291d45',
    '#fff8ed': '#2a2119',
    '#f4fbf8': '#10211f',
    '#f7f7f4': '#141e31',
    '#edf7f5': '#142f31',
    '#f1f7f6': '#172d30',
    '#eeeeea': '#1a2334',
    '#fff8e8': '#2a2117',
    '#f1f2f4': '#172136',
    '#f6f7fb': '#121c30',
    '#eef4ff': '#162541',
    '#fff0dc': '#2b2117',
    '#f2fbf8': '#10211f',
    'rgba(255,254,250,0.92)': '#10192c',
    'rgba(255,255,255,0.84)': '#142039',
    'rgba(255,255,255,0.88)': '#142039',
    'rgba(255,255,255,0.9)': '#142039',
    'rgba(255,255,255,0.76)': '#142039'
  };
  const darkForegrounds: Record<string, string> = {
    '#0b1020': '#f4f7ff',
    '#111827': '#eef3ff',
    '#181716': '#f4f7ff',
    '#1f2937': '#e6ecfa',
    '#334155': '#c4cee3',
    '#475569': '#aab8d2',
    '#64748b': '#8a9abd'
  };
  Object.entries(definitions).forEach(([key, style]) => {
    if (!style || typeof style !== 'object' || Array.isArray(style)) return;
    const backgroundColor = Reflect.get(style, 'backgroundColor');
    const background = typeof backgroundColor === 'string' ? backgroundColor.toLowerCase() : '';
    if (background && lightSurfaces[background]) {
      Reflect.set(style, 'backgroundColor', key === 'membershipQrCode' ? '#ffffff' : lightSurfaces[background]);
    }
    const color = Reflect.get(style, 'color');
    const foreground = typeof color === 'string' ? color.toLowerCase() : '';
    if (foreground && darkForegrounds[foreground]) Reflect.set(style, 'color', darkForegrounds[foreground]);
  });
  return definitions;
}
