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

export function applyDarkComponentTheme<T extends Record<string, any>>(definitions: T): T {
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
    const background = typeof style.backgroundColor === 'string' ? style.backgroundColor.toLowerCase() : '';
    if (background && lightSurfaces[background]) {
      style.backgroundColor = key === 'membershipQrCode' ? '#ffffff' : lightSurfaces[background];
    }
    const foreground = typeof style.color === 'string' ? style.color.toLowerCase() : '';
    if (foreground && darkForegrounds[foreground]) style.color = darkForegrounds[foreground];
  });
  return definitions;
}
