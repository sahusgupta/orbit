import type { Metadata } from 'next';
import { AuthGate } from '@/src/components/auth/auth-gate';
import { ProfileEditor } from '@/src/components/my-orbit/profile-editor';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({ title: 'Player profile', description: 'Manage the identity, home-area preference, stakes, availability, and eligibility details attached to your Orbit account.', path: '/me/profile', noIndex: true });
export default function ProfilePage() { return <AuthGate returnTo="/me/profile"><section className="my-section"><header className="section-heading"><div><p className="eyebrow">Identity and preferences</p><h2>Profile</h2><p>Keep the details clubs use to recognize your request.</p></div></header><ProfileEditor /></section></AuthGate>; }
