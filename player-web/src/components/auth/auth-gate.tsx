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
  if (status === 'error') return <ErrorState title="My Orbit could not open" message={error} />;
  if (status !== 'signed-in') {
    return (
      <section className="auth-required">
        <LockKeyhole aria-hidden="true" size={28} />
        <p className="eyebrow">Private player space</p>
        <h2>Sign in to open My Orbit.</h2>
        <p>Your clubs, game commitments, registrations, and profile are visible only to your verified account.</p>
        <ButtonLink href={buildSignInHref(returnTo)}>Sign in</ButtonLink>
      </section>
    );
  }
  return children;
}
