import { describe, expect, it } from 'vitest';
import { absoluteUrl, createPageMetadata, serializeJsonLd, siteConfig } from './site';

describe('Orbit web metadata contract', () => {
  it('uses Orbit as the public product name and the real developer identity', () => {
    expect(siteConfig.name).toBe('Orbit');
    expect(siteConfig.developer).toEqual({ name: 'Caminus Labs, LLC', url: 'https://caminuslabs.com/' });
  });

  it('resolves canonical paths against the configured public origin', () => {
    expect(absoluteUrl('/games')).toBe(`${siteConfig.origin}/games`);
  });

  it('creates canonical, Open Graph, and Twitter metadata together', () => {
    const metadata = createPageMetadata({ title: 'Current games', description: 'Current poker games.', path: '/games' });
    expect(metadata.title).toBe('Current games');
    expect(metadata.description).toBe('Current poker games.');
    expect(metadata.alternates).toEqual({ canonical: '/games' });
    expect(metadata.openGraph).toMatchObject({ title: 'Current games | Orbit', url: '/games', images: [siteConfig.image] });
    expect(metadata.twitter).toMatchObject({ card: 'summary_large_image', title: 'Current games | Orbit' });
  });

  it('marks private routes as noindex without removing their canonical URL', () => {
    const metadata = createPageMetadata({ title: 'My Games', description: 'Private games.', path: '/me/games', noIndex: true });
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.alternates).toEqual({ canonical: '/me/games' });
  });

  it('escapes markup-significant characters in structured data', () => {
    expect(serializeJsonLd({ value: '</script><script>' })).not.toContain('</script>');
    expect(serializeJsonLd({ value: '</script><script>' })).toContain('\\u003c');
  });
});
