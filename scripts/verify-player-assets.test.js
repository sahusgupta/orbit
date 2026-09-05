import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { alphaAt, decodeRgbaPng } from './verify-player-assets.mjs';

const root = path.resolve(process.cwd());

describe('Orbit Player release artwork', () => {
  it('keeps the App Store icon opaque and the splash corners transparent', () => {
    const icon = decodeRgbaPng(path.join(root, 'player-app/assets/icon.png'));
    const splash = decodeRgbaPng(path.join(root, 'player-app/assets/splash-icon-transparent.png'));

    expect([icon.width, icon.height]).toEqual([1024, 1024]);
    expect(icon.pixels.filter((_value, index) => index % 4 === 3).every((alpha) => alpha === 255)).toBe(true);
    expect([splash.width, splash.height]).toEqual([1254, 1254]);
    expect([
      alphaAt(splash, 0, 0),
      alphaAt(splash, splash.width - 1, 0),
      alphaAt(splash, 0, splash.height - 1),
      alphaAt(splash, splash.width - 1, splash.height - 1)
    ]).toEqual([0, 0, 0, 0]);
  });
});
