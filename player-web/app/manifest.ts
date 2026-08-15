import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Orbit Player',
    short_name: 'Orbit Player',
    description: 'Find nearby poker games that fit, then manage memberships, waitlists, and registrations in one place.',
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
