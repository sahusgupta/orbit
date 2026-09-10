import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { GlobalStructuredData } from '@/src/components/seo/structured-data';
import { RouteShell } from '@/src/components/shell/route-shell';
import { siteConfig } from '@/src/seo/site';
import './globals.css';

const landingSans = localFont({
  display: 'swap',
  variable: '--font-landing-sans',
  src: [
    { path: './fonts/manrope-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/manrope-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/manrope-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/manrope-latin-700-normal.woff2', weight: '700', style: 'normal' }
  ]
});

const landingMono = localFont({
  display: 'swap',
  variable: '--font-landing-mono',
  src: [
    { path: './fonts/dm-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/dm-mono-latin-500-normal.woff2', weight: '500', style: 'normal' }
  ]
});

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.origin),
  title: { default: 'Orbit Player | Browse published poker games', template: '%s | Orbit Player' },
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
    title: 'Orbit Player | Browse published poker games',
    description: siteConfig.description,
    url: '/',
    images: [siteConfig.image]
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Orbit Player | Browse published poker games',
    description: siteConfig.description,
    images: [{ url: siteConfig.image.url, alt: siteConfig.image.alt }]
  },
  icons: { icon: [{ url: '/favicon.ico' }, { url: '/icon.png', type: 'image/png' }], apple: '/apple-icon.png' }
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${landingSans.variable} ${landingMono.variable}`}>
      <body>
        <noscript>
          <div className="page-shell" role="alert">
            <p>Turn on JavaScript to use Orbit Player.</p>
            <a href="https://orbitapp-one.vercel.app/privacy">Read the Privacy Policy</a>
          </div>
        </noscript>
        <GlobalStructuredData />
        <RouteShell>{children}</RouteShell>
      </body>
    </html>
  );
}
