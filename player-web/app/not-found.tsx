import { Compass } from 'lucide-react';
import type { Metadata } from 'next';
import { ButtonLink } from '@/src/components/ui/button';
import { createPageMetadata } from '@/src/seo/site';

export const metadata: Metadata = createPageMetadata({
  title: 'Page not found',
  description: 'That Orbit page is unavailable. Return to current poker game discovery.',
  path: '/404',
  noIndex: true
});

export default function NotFound() {
  return <section className="not-found"><Compass aria-hidden="true" size={32} /><p className="eyebrow">Off orbit</p><h1>That live poker link is no longer available.</h1><p>The game, club, or tournament may have changed. Current discovery is one step away.</p><ButtonLink href="/games">Browse current games</ButtonLink></section>;
}
