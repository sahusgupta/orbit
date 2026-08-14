import type { Metadata } from 'next';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { MyTournaments } from '@/src/components/my-orbit/sections';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({ title: 'My Tournaments', description: 'Review your Orbit tournament registrations and upcoming event details.', path: '/me/tournaments', noIndex: true });
export default function MyTournamentsPage() { return <AuthGate returnTo="/me/tournaments"><MyTournaments /></AuthGate>; }
