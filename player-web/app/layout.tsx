import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { GlobalStructuredData } from '@/src/components/seo/structured-data';
import { AmbientFlow } from '@/src/components/shell/ambient-flow';
import { Providers } from '@/src/components/shell/providers';
import { SiteFooter } from '@/src/components/shell/site-footer';
import { SiteHeader } from '@/src/components/shell/site-header';
import { siteConfig } from '@/src/seo/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.origin),
  title: { default: 'Orbit | Find live poker', template: '%s | Orbit' },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.developer.name, url: siteConfig.developer.url }],
  creator: siteConfig.developer.name,
  publisher: siteConfig.developer.name,
  category: 'live poker discovery',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    title: 'Orbit | Find live poker',
    description: siteConfig.description,
    url: '/',
    images: [siteConfig.image]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Orbit | Find live poker',
    description: siteConfig.description,
    images: [{ url: siteConfig.image.url, alt: siteConfig.image.alt }]
  },
  icons: { icon: [{ url: '/favicon.ico' }, { url: '/icon.png', type: 'image/png' }], apple: '/apple-icon.png' }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AmbientFlow />
        <GlobalStructuredData />
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <Providers>
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
