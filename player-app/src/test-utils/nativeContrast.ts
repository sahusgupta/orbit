// Preserve the real native paint values in DOM-backed component tests.
export function nativePaintStyle(style: unknown): { color?: string; backgroundColor?: string } {
  if (Array.isArray(style)) return style.reduce((paint, entry) => ({ ...paint, ...nativePaintStyle(entry) }), {});
  const paint: { color?: string; backgroundColor?: string } = {};
  if (style && typeof style === 'object') {
    for (const property of ['color', 'backgroundColor'] as const) {
      const value: unknown = Reflect.get(style, property);
      if (typeof value === 'string') paint[property] = value;
    }
  }
  return paint;
}

type Rgba = [number, number, number, number];
function rgb(value: string): Rgba {
  const match = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(value);
  if (!match) throw new Error(`Expected a computed RGB color, received ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? 1 : Number(match[4])];
}

function over(foreground: Rgba, background: Rgba): Rgba {
  return [
    foreground[0] * foreground[3] + background[0] * (1 - foreground[3]),
    foreground[1] * foreground[3] + background[1] * (1 - foreground[3]),
    foreground[2] * foreground[3] + background[2] * (1 - foreground[3]),
    1
  ];
}

function luminance(color: Rgba) {
  const linear = color.slice(0, 3).map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

// WCAG 2.2 SC 1.4.3: actual text paint versus its composed ancestor background.
export function nativeTextContrast(element: Element | null | undefined): number {
  if (!element) throw new Error('The text to inspect must be rendered.');
  const layers: Rgba[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const background = rgb(getComputedStyle(current).backgroundColor);
    layers.push(background);
    if (background[3] === 1) break;
  }
  let background = layers.pop();
  if (!background || background[3] !== 1) throw new Error('Render inside the native canvas background.');
  for (const layer of layers.reverse()) background = over(layer, background);
  const foreground = over(rgb(getComputedStyle(element).color), background);
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}
