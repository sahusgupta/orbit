import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { pageUrl, publicPages, renderPageMetadata, resolvePublicOrigin } from './public-config.mjs';

function publicSiteBuild(publicOrigin) {
  const outputDir = fileURLToPath(new URL('../download-dist', import.meta.url));
  return {
    name: 'orbit-public-site-build',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const fileName = path.basename(context.filename);
        const page = publicPages[fileName];
        if (!page) throw new Error(`Missing public-page metadata for ${fileName}.`);
        if (!html.includes('<!-- orbit-public-metadata -->')) {
          throw new Error(`Missing public metadata insertion point in ${fileName}.`);
        }
        return html.replace('<!-- orbit-public-metadata -->', renderPageMetadata(publicOrigin, page));
      }
    },
    closeBundle() {
      fs.rmSync(path.join(outputDir, 'downloads'), { recursive: true, force: true });
      const indexedPages = Object.values(publicPages).filter((page) => page.indexable);
      const sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        ...indexedPages.map((page) => `  <url><loc>${pageUrl(publicOrigin, page)}</loc></url>`),
        '</urlset>',
        ''
      ].join('\n');
      const robots = [
        'User-agent: *',
        'Allow: /',
        'Disallow: /dashboard',
        'Disallow: /api',
        'Disallow: /player',
        'Disallow: /clients',
        'Disallow: /state',
        'Disallow: /webhooks',
        'Disallow: /health',
        '',
        'User-agent: GPTBot',
        'Allow: /',
        '',
        'User-agent: ClaudeBot',
        'Allow: /',
        '',
        `Sitemap: ${new URL('/sitemap.xml', `${publicOrigin}/`).href}`,
        ''
      ].join('\n');
      const llms = [
        '# Orbit',
        '',
        '> Orbit connects live poker room demand, waitlists, seating, tables, memberships, tournaments, and reporting.',
        '',
        '## Public pages',
        '',
        ...indexedPages.map((page) => `- [${page.title}](${pageUrl(publicOrigin, page)}): ${page.description}`),
        '',
        'Authenticated, administrative, API, player-private, and venue-private routes are outside this public-content index.',
        ''
      ].join('\n');
      const aiPolicy = [
        '# Orbit public AI crawler policy',
        '',
        'Automated crawlers may index the public static pages listed in sitemap.xml.',
        'Do not crawl authenticated, administrative, API, player-private, or venue-private routes.',
        'Public access does not grant access to private Orbit application data or credentials.',
        ''
      ].join('\n');
      fs.writeFileSync(path.join(outputDir, 'sitemap.xml'), sitemap);
      fs.writeFileSync(path.join(outputDir, 'robots.txt'), robots);
      fs.writeFileSync(path.join(outputDir, 'llms.txt'), llms);
      fs.writeFileSync(path.join(outputDir, 'ai-policy.txt'), aiPolicy);
      fs.copyFileSync(fileURLToPath(new URL('./orbit-icon.png', import.meta.url)), path.join(outputDir, 'orbit-icon.png'));
    }
  };
}

export default defineConfig(() => {
  const publicOrigin = resolvePublicOrigin();
  return {
    root: fileURLToPath(new URL('.', import.meta.url)),
    base: './',
    publicDir: 'public',
    plugins: [publicSiteBuild(publicOrigin)],
    build: {
      outDir: '../download-dist',
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          index: fileURLToPath(new URL('./index.html', import.meta.url)),
          product: fileURLToPath(new URL('./product.html', import.meta.url)),
          support: fileURLToPath(new URL('./support.html', import.meta.url)),
          privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
          terms: fileURLToPath(new URL('./terms.html', import.meta.url)),
          notFound: fileURLToPath(new URL('./404.html', import.meta.url)),
          serverError: fileURLToPath(new URL('./500.html', import.meta.url))
        }
      }
    }
  };
});
