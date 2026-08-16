import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/src/seo/site';

export default function robots(): MetadataRoute.Robots {
  const privateRoutes = ['/games', '/games/', '/clubs', '/clubs/', '/tournaments', '/tournaments/', '/me', '/me/', '/sign-in'];
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: privateRoutes },
      { userAgent: 'GPTBot', allow: '/', disallow: privateRoutes },
      { userAgent: 'ChatGPT-User', allow: '/', disallow: privateRoutes },
      { userAgent: 'OAI-SearchBot', allow: '/', disallow: privateRoutes },
      { userAgent: 'ClaudeBot', allow: '/', disallow: privateRoutes },
      { userAgent: 'PerplexityBot', allow: '/', disallow: privateRoutes },
      { userAgent: 'Google-Extended', allow: '/', disallow: privateRoutes }
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: absoluteUrl('/')
  };
}
