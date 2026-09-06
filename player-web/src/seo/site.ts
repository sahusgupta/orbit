import type { Metadata } from 'next';

const fallbackOrigin = 'http://127.0.0.1:4175';

export const siteConfig = {
  name: 'Orbit Player',
  description: 'Find room-published poker games, then manage club memberships, waitlists, and nonbinding tournament interest.',
  origin: (process.env.NEXT_PUBLIC_PLAYER_WEB_URL || fallbackOrigin).replace(/\/$/, ''),
  developer: {
    name: 'Caminus Labs, LLC',
    url: 'https://caminuslabs.com/'
  },
  social: {
    github: 'https://github.com/sahusgupta/orbit'
  },
  image: {
    url: '/orbit-table-rhythm.jpg',
    width: 1536,
    height: 1024,
    alt: 'Abstract overhead composition of a poker table, face-down cards, and table markers.'
  }
} as const;

export function absoluteUrl(path = '/') {
  return new URL(path, `${siteConfig.origin}/`).toString();
}

export function createPageMetadata({
  title,
  description,
  path,
  noIndex = false
}: {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
}): Metadata {
  const pageTitle = `${title} | ${siteConfig.name}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: siteConfig.name,
      title: pageTitle,
      description,
      url: path,
      images: [siteConfig.image]
    },
    twitter: {
      card: 'summary_large_image',
      title: pageTitle,
      description,
      images: [{ url: siteConfig.image.url, alt: siteConfig.image.alt }]
    }
  };
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
