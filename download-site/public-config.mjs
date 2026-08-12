const localOrigin = 'http://127.0.0.1:4174';

export const publicPages = Object.freeze({
  'index.html': {
    path: '/',
    title: 'Orbit | Live poker room operations',
    description: 'Orbit connects live poker room demand, waitlists, seating, tables, memberships, tournaments, and reporting.',
    schemaType: 'WebSite',
    indexable: true
  },
  'product.html': {
    path: '/product.html',
    title: 'Orbit Product | Connected poker room workflows',
    description: 'See how Orbit connects demand, waitlists, seating, player records, tournaments, and closeout for live poker rooms.',
    schemaType: 'SoftwareApplication',
    indexable: true
  },
  'faq.html': {
    path: '/faq.html',
    title: 'Orbit FAQ | Product, identity, and release answers',
    description: 'Factual answers about Orbit poker room operations, player identity, connectivity, releases, and account support.',
    schemaType: 'WebPage',
    indexable: true
  },
  'support.html': {
    path: '/support.html',
    title: 'Orbit Support | Account and installation help',
    description: 'Get Orbit help with account access, installation, membership requests, waitlists, purchases, and room operations.',
    schemaType: 'WebPage',
    indexable: true
  },
  'privacy.html': {
    path: '/privacy.html',
    title: 'Orbit Privacy Policy',
    description: 'How Orbit handles personal data across player, venue, organizer, website, event, and hardware-enabled experiences.',
    schemaType: 'WebPage',
    indexable: true
  },
  'terms.html': {
    path: '/terms.html',
    title: 'Orbit Terms of Service',
    description: 'Rules for using the Orbit platform and participating in the Orbit network.',
    schemaType: 'WebPage',
    indexable: true
  },
  '404.html': {
    path: '/404.html',
    title: 'Page not found | Orbit',
    description: 'The requested Orbit public page could not be found.',
    schemaType: 'WebPage',
    indexable: false
  },
  '500.html': {
    path: '/500.html',
    title: 'Service temporarily unavailable | Orbit',
    description: 'The Orbit public site is temporarily unavailable. Use the static support routes or try again shortly.',
    schemaType: 'WebPage',
    indexable: false
  }
});

function requireHttpOrigin(value, source) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${source} must be an absolute HTTP(S) origin.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${source} must be an absolute HTTP(S) origin without credentials, query, or fragment.`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`${source} must not include a path.`);
  }
  return url.origin;
}

export function resolvePublicOrigin(environment = process.env) {
  if (environment.ORBIT_PUBLIC_ORIGIN) {
    return requireHttpOrigin(environment.ORBIT_PUBLIC_ORIGIN, 'ORBIT_PUBLIC_ORIGIN');
  }
  if (environment.ORBIT_PUBLIC_PREVIEW_ORIGIN) {
    return requireHttpOrigin(environment.ORBIT_PUBLIC_PREVIEW_ORIGIN, 'ORBIT_PUBLIC_PREVIEW_ORIGIN');
  }
  if (environment.VERCEL_URL) {
    const previewUrl = environment.VERCEL_URL.includes('://')
      ? environment.VERCEL_URL
      : `https://${environment.VERCEL_URL}`;
    return requireHttpOrigin(previewUrl, 'VERCEL_URL');
  }
  return requireHttpOrigin(environment.ORBIT_PUBLIC_LOCAL_ORIGIN || localOrigin, 'ORBIT_PUBLIC_LOCAL_ORIGIN');
}

export function pageUrl(origin, page) {
  return new URL(page.path, `${origin}/`).href;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function renderPageMetadata(origin, page) {
  const canonical = pageUrl(origin, page);
  const image = new URL('/orbit-icon.png', `${origin}/`).href;
  const schema = page.schemaType === 'SoftwareApplication'
    ? {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Orbit',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Windows',
        description: page.description,
        url: canonical
      }
    : {
        '@context': 'https://schema.org',
        '@type': page.schemaType,
        name: page.title,
        description: page.description,
        url: canonical
      };
  const robots = page.indexable ? 'index,follow' : 'noindex,follow';

  return [
    `<link rel="canonical" href="${escapeAttribute(canonical)}" />`,
    `<meta name="robots" content="${robots}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Orbit" />',
    `<meta property="og:title" content="${escapeAttribute(page.title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(page.description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(canonical)}" />`,
    `<meta property="og:image" content="${escapeAttribute(image)}" />`,
    '<meta property="og:image:width" content="512" />',
    '<meta property="og:image:height" content="512" />',
    '<meta property="og:image:alt" content="Orbit circular brand mark" />',
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${escapeAttribute(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(page.description)}" />`,
    `<meta name="twitter:image" content="${escapeAttribute(image)}" />`,
    `<script type="application/ld+json">${JSON.stringify(schema).replaceAll('<', '\\u003c')}</script>`
  ].join('\n    ');
}
