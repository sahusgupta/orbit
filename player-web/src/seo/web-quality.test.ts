import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(process.cwd());
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('public web quality contracts', () => {
  it('keeps production browser source maps off and optimizes the icon package', () => {
    const config = read('next.config.ts');

    expect(config).toContain('productionBrowserSourceMaps: false');
    expect(config).toContain("optimizePackageImports: ['lucide-react']");
    expect(config).toContain('removeConsole');
  });

  it('explicitly permits major AI crawlers while protecting account routes', () => {
    const robots = read('app/robots.ts');

    for (const crawler of ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) {
      expect(robots).toContain(crawler);
    }
    expect(robots).toContain("'/me/'");
    expect(robots).toContain("'/sign-in'");
  });

  it('publishes an AI-readable product summary with real ownership and route boundaries', () => {
    const llms = read('public/llms.txt');

    expect(llms).toContain('Caminus Labs, LLC');
    expect(llms).toContain('/games');
    expect(llms).toContain('/tournaments');
    expect(llms).toContain('/clubs');
    expect(llms).toContain('/me');
    expect(llms).toContain('https://github.com/sahusgupta/orbit');
  });

  it('uses the canonical Orbit logo and a real image with descriptive alt text', () => {
    const home = read('app/page.tsx');
    const header = read('src/components/shell/site-header.tsx');
    const footer = read('src/components/shell/site-footer.tsx');

    expect(home).toContain('src="/orbit-table-rhythm.jpg"');
    expect(home).toContain('alt="Abstract overhead composition of a poker table, face-down cards, and table markers."');
    expect(header).toContain('src="/orbit-logo.svg"');
    expect(footer).toContain('src="/orbit-logo.svg"');
  });

  it('turns the homepage hook into an accessible interactive poker hand', () => {
    const home = read('app/page.tsx');
    const cards = read('src/components/home/orbit-feature-cards.tsx');

    expect(home).toContain('<OrbitFeatureCards />');
    expect(cards).toContain("from 'motion/react'");
    expect(cards).toContain("from '@/src/components/ui/button'");
    expect(cards).toContain('aria-pressed={active}');
    expect(cards).toContain('useReducedMotion()');
    for (const feature of ['Running now', 'Building a table', 'Registration open']) {
      expect(cards).toContain(feature);
    }
  });

  it('keeps landing navigation out of the initial viewport and reveals it after scroll', () => {
    const header = read('src/components/shell/site-header.tsx');
    const styles = read('styles/components.css');

    expect(header).toContain("window.scrollY > 48");
    expect(header).toContain("const isHome = pathname === '/'");
    expect(header).toContain('const visible = !isHome || homeVisible');
    expect(header).toContain("data-visible={visible}");
    expect(header).toContain("@base-ui/react/menu");
    expect(styles).toContain('.site-header[data-home="true"][data-visible="true"]');
  });

  it('uses the selected design-system primitives at their interaction boundaries', () => {
    const sources = [
      read('src/components/ui/button.tsx'),
      read('src/components/ui/fields.tsx'),
      read('src/components/ui/dialog.tsx'),
      read('src/components/ui/disclosure.tsx'),
      read('src/components/home/orbit-faq.tsx'),
      read('src/components/vendor/watermelon/faq.tsx'),
      read('src/components/actions/game-action.tsx'),
      read('src/components/actions/club-membership-action.tsx')
    ].join('\n');
    const motionOwner = read('src/components/ui/scroll-reveal.tsx');
    const motionPrimitive = read('src/components/vendor/motion-primitives/in-view.tsx');
    const haikei = read('src/components/vendor/haikei/layered-waves.tsx');
    const background = read('styles/base.css');

    for (const primitive of ['@base-ui/react/button', '@base-ui/react/input', '@base-ui/react/select', '@base-ui/react/dialog', '@base-ui/react/form', '@base-ui/react/radio']) {
      expect(sources).toContain(primitive);
    }
    expect(sources).toContain('data-watermelon-component="faq-1-adapted"');
    expect(motionOwner).toContain("from '@/src/components/vendor/motion-primitives/in-view'");
    expect(motionPrimitive).toContain("from 'motion/react'");
    expect(motionPrimitive).toContain('data-motion-primitive={primitiveName}');
    expect(haikei).toContain('data-haikei-generator="layered-waves"');
    expect(background).toContain("url('/orbit-layered-waves.svg')");
  });

  it('publishes a code-backed privacy inventory and AI-development disclosure', () => {
    const privacy = read('app/privacy/page.tsx');
    const footer = read('src/components/shell/site-footer.tsx');
    const sitemap = read('app/sitemap.ts');

    for (const service of ['Google Firebase and Google Cloud', 'Vercel', 'Stripe', 'Twilio', 'RevenueCat', 'Apple App Store', 'OpenStreetMap Foundation', 'Expo Application Services', 'GitHub']) {
      expect(privacy).toContain(service);
    }
    expect(privacy).toContain('built with assistance from AI development tools, including OpenAI Codex');
    expect(privacy).toContain('currently has no user-facing generative-AI runtime feature');
    expect(privacy.match(/<h1>/g)).toHaveLength(1);
    expect(footer).toContain('<Link href="/privacy">Privacy</Link>');
    expect(sitemap).toContain("absoluteUrl('/privacy')");
  });

  it('uses concise visible route titles without explanatory tab subtitles', () => {
    const routeTitles = [
      ['app/games/page.tsx', '<h1>Games</h1>'],
      ['app/clubs/page.tsx', '<h1>Clubs</h1>'],
      ['app/tournaments/page.tsx', '<h1>Tournaments</h1>']
    ] as const;

    for (const [route, title] of routeTitles) {
      const source = read(route);
      expect(source).toContain(title);
      expect(source).not.toMatch(/<h1>[^<]+<\/h1><p>/);
    }
  });

  it('keeps the landing presentation concise and centers only presentation-led content', () => {
    const home = read('app/page.tsx');
    const faq = read('src/components/home/orbit-faq.tsx');
    const routes = read('styles/routes.css');

    expect(home).not.toContain('See what rooms say is running');
    expect(faq).not.toContain('Orbit shows what rooms have actually published');
    expect(routes).toContain('.home-hero__copy { align-content: center; align-items: center;');
    expect(routes).toContain('justify-items: center; text-align: center;');
    expect(routes).not.toContain('.home-section .section-heading');
    expect(routes).toContain('.faq-intro { align-content: start;');
    expect(routes).toContain('.orbit-loop h2 { margin: 10px auto 0; max-width: 680px; text-align: center; }');
  });

  it('uses the footer as the final opaque page boundary', () => {
    const footer = read('src/components/shell/site-footer.tsx');
    const base = read('styles/base.css');
    const components = read('styles/components.css');

    expect(footer).toContain('className="site-footer__inner"');
    expect(base).toContain('display: flex; flex-direction: column;');
    expect(base).toContain('main { flex: 1 0 auto;');
    expect(components).toContain('.site-footer { background: var(--canvas);');
  });

  it('avoids prohibited visual and marketing patterns in production sources', () => {
    const production = [
      read('app/page.tsx'),
      read('styles/base.css'),
      read('styles/components.css'),
      read('styles/routes.css'),
      read('styles/responsive.css')
    ].join('\n').toLowerCase();

    for (const prohibited of [
      'backdrop-filter',
      'linear-gradient',
      'radial-gradient',
      'trusted by',
      'testimonial',
      'visitor counter',
      'pricing card'
    ]) {
      expect(production).not.toContain(prohibited);
    }
  });
});
