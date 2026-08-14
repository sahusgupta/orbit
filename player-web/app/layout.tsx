import type { Metadata } from 'next';
import { DM_Mono, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { GlobalStructuredData } from '@/src/components/seo/structured-data';
import { RouteShell } from '@/src/components/shell/route-shell';
import { siteConfig } from '@/src/seo/site';
import './globals.css';

const landingSans = Manrope({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-landing-sans',
  weight: ['400', '500', '600', '700']
});

const landingMono = DM_Mono({
  display: 'swap',
  subsets: ['latin'],
  variable: '--font-landing-mono',
  weight: ['400', '500']
});

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
    <html lang="en" className={`${landingSans.variable} ${landingMono.variable}`}>
      <body>
        <GlobalStructuredData />
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}
