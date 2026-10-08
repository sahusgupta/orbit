import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { alphaAt, decodeRgbaPng, verifyPlayerAssetConfiguration } from './verify-player-assets.mjs';

const require = createRequire(import.meta.url);
const { createExpoConfig } = require('../player-app/release-config.cjs');

const root = path.resolve(process.cwd());

describe('Orbit Player release artwork', () => {
  it('checks the SDK 57 splash plugin without requiring the removed legacy splash field', () => {
    const config = createExpoConfig({ icon: './assets/icon.png' }, {});
    expect(config).not.toHaveProperty('splash');
    expect(() => verifyPlayerAssetConfiguration(config)).not.toThrow();
  });

  it.each(['image', 'backgroundColor', 'resizeMode'])('rejects unreviewed splash %s', (field) => {
    const config = createExpoConfig({ icon: './assets/icon.png' }, {});
    const splash = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    splash[1][field] = 'unreviewed';
    expect(() => verifyPlayerAssetConfiguration(config)).toThrow(/reviewed artwork and appearance/);
  });

  it('rejects a missing or duplicate splash plugin', () => {
    const config = createExpoConfig({ icon: './assets/icon.png' }, {});
    const splash = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen');
    expect(() => verifyPlayerAssetConfiguration({ ...config, plugins: [] })).toThrow(/Exactly one/);
    expect(() => verifyPlayerAssetConfiguration({ ...config, plugins: [...config.plugins, splash] })).toThrow(/Exactly one/);
  });

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
