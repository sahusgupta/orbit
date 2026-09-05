import type { Metadata } from 'next';
import PlayerLanding from '@/src/components/home/player-landing';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = {
  ...createPageMetadata({
    title: 'Published poker games',
    description: 'Use Orbit Player to browse venue-published poker games, waitlists, memberships, and tournament interest.',
    path: '/'
  }),
  title: { absolute: 'Browse published poker games | Orbit Player' }
};

export default function HomePage() {
  return <PlayerLanding />;
}
