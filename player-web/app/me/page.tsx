import type { Metadata } from 'next';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { MyOrbitOverview } from '@/src/components/my-orbit/sections';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({ title: 'My Orbit', description: 'Review your current game requests, memberships, tournaments, and next player actions.', path: '/me', noIndex: true });

export default function MyOrbitPage() { return <AuthGate returnTo="/me"><MyOrbitOverview /></AuthGate>; }
