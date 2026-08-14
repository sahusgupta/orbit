import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit',
    short_name: 'Orbit',
    description: 'Find current live poker games, clubs, and tournaments, then take the next player action through Orbit.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070d16',
    theme_color: '#070d16',
    icons: [
      { src: '/orbit-icon.png', sizes: '512x512', type: 'image/png' },
      { src: '/orbit-logo.svg', sizes: 'any', type: 'image/svg+xml' }
    ]
  };
}
