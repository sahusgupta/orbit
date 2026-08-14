import type { Metadata } from 'next';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { MyClubs } from '@/src/components/my-orbit/sections';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({ title: 'My Clubs', description: 'Review active, requested, and expired Orbit club memberships.', path: '/me/clubs', noIndex: true });
export default function MyClubsPage() { return <AuthGate returnTo="/me/clubs"><MyClubs /></AuthGate>; }
