import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignInForm } from '@/src/components/auth/sign-in-form';
import { SkeletonList } from '@/src/components/ui/state-panels';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({
  title: 'Sign in',
  description: 'Connect a verified Orbit account to memberships, game requests, tournament registration, and My Orbit.',
  path: '/sign-in',
  noIndex: true
});

export default function SignInPage() {
  return <div className="auth-page"><div className="auth-page__atmosphere" aria-hidden="true"><span /><span /><span /></div><Suspense fallback={<SkeletonList rows={3} />}><SignInForm /></Suspense></div>;
}
