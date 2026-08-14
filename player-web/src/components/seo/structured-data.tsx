import { absoluteUrl, serializeJsonLd, siteConfig } from '@/src/seo/site';

export function StructuredData({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

export function GlobalStructuredData() {
  const organizationId = `${siteConfig.developer.url}#organization`;
  const websiteId = `${absoluteUrl('/')}#website`;
  return (
    <StructuredData data={[
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        '@id': organizationId,
        name: siteConfig.developer.name,
        url: siteConfig.developer.url,
        email: 'hello@caminuslabs.com',
        sameAs: [siteConfig.social.github]
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': websiteId,
        name: siteConfig.name,
        url: absoluteUrl('/'),
        description: siteConfig.description,
        publisher: { '@id': organizationId },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${absoluteUrl('/games')}?q={search_term_string}`,
          'query-input': 'required name=search_term_string'
        }
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: siteConfig.name,
        url: absoluteUrl('/'),
        image: absoluteUrl(siteConfig.image.url),
        applicationCategory: 'LifestyleApplication',
        operatingSystem: 'Web',
        description: siteConfig.description,
        author: { '@id': organizationId }
      }
    ]} />
  );
}
