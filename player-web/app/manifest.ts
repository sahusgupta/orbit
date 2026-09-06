import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit Player',
    short_name: 'Orbit Player',
    description: 'Find room-published poker games, then manage memberships, waitlists, and tournament interest.',
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
