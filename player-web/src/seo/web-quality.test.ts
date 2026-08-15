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

  it('uses the canonical Orbit logo and favicon throughout the landing shell', () => {
    const landing = read('src/components/home/player-landing.tsx');
    const layout = read('app/layout.tsx');
    const header = read('src/components/shell/site-header.tsx');
    const footer = read('src/components/shell/site-footer.tsx');

    expect(landing.match(/src="\/orbit-logo\.svg"/g)).toHaveLength(2);
    expect(layout).toContain("icons: { icon: [{ url: '/favicon.ico' }");
    expect(header).toContain('src="/orbit-logo.svg"');
    expect(footer).toContain('src="/orbit-logo.svg"');
  });

  it('keeps the supplied orbital, swipe, and queue interactions while adding membership management', () => {
    const landing = read('src/components/home/player-landing.tsx');

    expect(landing).toContain('from "motion/react"');
    expect(landing).toContain('drag="x"');
    expect(landing).toContain('function Orbital');
    expect(landing).toContain('function SwipeCard');
    expect(landing).toContain('function WaitlistContent');
    expect(landing).toContain('function MembershipContent');
    expect(landing).toContain('<OrbitFeatureCards />');
    for (const feature of ['Discover', 'Join', 'Queue', 'Memberships']) {
      expect(landing).toContain(`label: "${feature}"`);
    }
  });

  it('rewires every landing destination without changing the product route owners', () => {
    const landing = read('src/components/home/player-landing.tsx');
    const shell = read('src/components/shell/route-shell.tsx');
    const layout = read('app/layout.tsx');

    expect(landing).not.toContain('href="#"');
    expect(landing).toContain('href="/games"');
    expect(landing).toContain('href="/me"');
    expect(landing).toContain('href="/me/clubs"');
    expect(landing).toContain('href="/sign-in?returnTo=%2Fme%2Fclubs"');
    expect(landing).toContain('href="/privacy"');
    expect(landing).toContain('href="https://orbitapp-one.vercel.app/terms"');
    expect(shell).toContain("if (pathname === '/')");
    expect(layout).toContain('<RouteShell>{children}</RouteShell>');
    expect(shell.indexOf("if (pathname === '/')")).toBeLessThan(shell.indexOf('<Providers>'));
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
    const ambient = read('src/components/shell/ambient-flow.tsx');
    const orbitBackground = read('src/components/shell/orbital-background.tsx');
    const background = read('styles/base.css');

    for (const primitive of ['@base-ui/react/button', '@base-ui/react/input', '@base-ui/react/select', '@base-ui/react/dialog', '@base-ui/react/form', '@base-ui/react/radio']) {
      expect(sources).toContain(primitive);
    }
    expect(sources).toContain('data-watermelon-component="faq-1-adapted"');
    expect(motionOwner).toContain("from '@/src/components/vendor/motion-primitives/in-view'");
    expect(motionPrimitive).toContain("from 'motion/react'");
    expect(motionPrimitive).toContain('data-motion-primitive={primitiveName}');
    expect(orbitBackground).toContain('ambient-flow__orbit--wide');
    expect(background).toContain('.ambient-flow__orbit');
    expect(ambient).not.toContain('addEventListener');
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

  it('delegates the home route to the supplied interactive landing presentation', () => {
    const home = read('app/page.tsx');
    const landing = read('src/components/home/player-landing.tsx');

    expect(home).toContain('<PlayerLanding />');
    expect(landing).toContain('Find poker games near you.');
    expect(landing).toContain('Keep every membership together.');
    expect(landing).toContain('manage all your poker-club memberships in one place');
    expect(landing).toContain('style={{ height: "500vh", position: "relative" }}');
    expect(landing).toContain('className="sticky top-0 overflow-hidden flex"');
  });

  it('uses the footer as the final opaque page boundary', () => {
    const footer = read('src/components/shell/site-footer.tsx');
    const base = read('styles/base.css');
    const components = read('styles/components.css');

    expect(footer).toContain('className="site-footer__inner"');
    expect(base).toContain('display: flex; flex-direction: column;');
    expect(base).toContain('main { flex: 1 0 auto;');
    expect(components).toContain('.site-footer { background: var(--canvas-deep);');
  });

  it('extends the landing palette and typography to every product route', () => {
    const tokens = read('styles/tokens.css');
    const manifest = read('app/manifest.ts');

    expect(tokens).toContain('font-family: var(--font-landing-sans)');
    expect(tokens).toContain('--font-mono: var(--font-landing-mono)');
    expect(tokens).toContain('--canvas: #070d16');
    expect(tokens).toContain('--primary: #191970');
    expect(tokens).toContain('--accent: #4aa8a0');
    expect(tokens).toContain('--ink: #f2ede3');
    expect(manifest.match(/#070d16/g)).toHaveLength(2);
  });

  it('updates local discovery filters without issuing a Next route request per keystroke', () => {
    const queryState = read('src/navigation/query-state.ts');
    const explorers = [
      read('src/components/discovery/games-explorer.tsx'),
      read('src/components/discovery/clubs-explorer.tsx'),
      read('src/components/discovery/tournaments-explorer.tsx')
    ].join('\n');

    expect(queryState).toContain('window.history.replaceState');
    expect(explorers).toContain('replaceRouteQuery(pathname, next)');
    expect(explorers).not.toContain('useRouter');
    expect(explorers).not.toContain('router.replace');
  });

  it('avoids prohibited visual and marketing patterns in production sources', () => {
    const production = [
      read('app/page.tsx'),
      read('styles/base.css'),
      read('styles/components.css'),
      read('styles/routes.css'),
      read('styles/responsive.css'),
      read('styles/landing.css'),
      read('src/components/home/player-landing.tsx')
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
