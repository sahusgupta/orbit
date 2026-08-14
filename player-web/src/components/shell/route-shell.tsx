'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AmbientFlow } from '@/src/components/shell/ambient-flow';
import { Providers } from '@/src/components/shell/providers';
import { SiteFooter } from '@/src/components/shell/site-footer';
import { SiteHeader } from '@/src/components/shell/site-header';

export function RouteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const content = <main id="main-content">{children}</main>;

  if (pathname === '/') {
    return (
      <>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        {content}
      </>
    );
  }

  return (
    <Providers>
      <AmbientFlow />
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteHeader />
      {content}
      <SiteFooter />
    </Providers>
  );
}
