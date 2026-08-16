import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/src/seo/site';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/'), changeFrequency: 'hourly', priority: 1 },
    { url: absoluteUrl('/privacy'), changeFrequency: 'monthly', priority: 0.4 }
  ];
}
