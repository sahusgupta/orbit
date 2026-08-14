import type { Metadata } from 'next';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { MyGames } from '@/src/components/my-orbit/sections';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({ title: 'My Games', description: 'Review active Orbit seat requests, arrival plans, interest, and waitlist position.', path: '/me/games', noIndex: true });
export default function MyGamesPage() { return <AuthGate returnTo="/me/games"><MyGames /></AuthGate>; }
