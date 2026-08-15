import type { Metadata } from 'next';
import PlayerLanding from '@/src/components/home/player-landing';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = {
  ...createPageMetadata({
    title: 'Poker games near you',
    description: 'Use Orbit Player to find nearby poker games that match your stakes and preferred format, then manage every club membership in one place.',
    path: '/'
  }),
  title: { absolute: 'Find poker games near you | Orbit Player' }
};

export default function HomePage() {
  return <PlayerLanding />;
}
