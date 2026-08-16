'use client';

import { LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { buildSignInHref } from '@/src/auth/intent';
import { ButtonLink } from '@/src/components/ui/button';
import { ErrorState, SkeletonList } from '@/src/components/ui/state-panels';

export function AuthGate({ returnTo, children }: { returnTo: string; children: ReactNode }) {
  const { status, error } = useAuth();
  if (status === 'loading') return <SkeletonList rows={4} />;
  if (status === 'error') return <ErrorState title="Your Orbit account could not open" message={error} />;
  if (status !== 'signed-in') {
    return (
      <section className="auth-required">
        <LockKeyhole aria-hidden="true" size={28} />
        <p className="eyebrow">Verified player access</p>
        <h2>Create an account or sign in to continue.</h2>
        <p>Orbit games, clubs, tournaments, commitments, and profile tools require a verified player account.</p>
        <ButtonLink href={buildSignInHref(returnTo)}>Sign in or create account</ButtonLink>
      </section>
    );
  }
  return children;
}
