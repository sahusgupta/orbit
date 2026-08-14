import type { Metadata } from 'next';
import PlayerLanding from '@/src/components/home/player-landing';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = {
  ...createPageMetadata({
    title: 'Find your seat',
    description: 'Find live poker at card houses and private rooms near you, request a seat, and track your place from Orbit Player.',
    path: '/'
  }),
  title: { absolute: 'Find your seat | Orbit' }
};

export default function HomePage() {
  return <PlayerLanding />;
}
