import { Code2, ExternalLink, Mail } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { siteConfig } from '@/src/seo/site';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <Link href="/" aria-label="Orbit home"><Image src="/orbit-logo.svg" width={34} height={34} alt="" /></Link>
          <div><strong>Orbit</strong><span>Developed by <a href={siteConfig.developer.url} rel="noreferrer" target="_blank">Caminus Labs, LLC<ExternalLink aria-hidden="true" size={12} /></a></span></div>
        </div>
        <div className="site-footer__links">
          <nav aria-label="Product navigation">
            <Link href="/games">Games</Link>
            <Link href="/clubs">Clubs</Link>
            <Link href="/tournaments">Tournaments</Link>
            <Link href="/privacy">Privacy</Link>
            <a href="https://orbitapp-one.vercel.app/support">Support</a>
          </nav>
          <nav className="social-links" aria-label="Orbit social and company links">
            <a href={siteConfig.social.github} rel="noreferrer" target="_blank"><Code2 aria-hidden="true" size={16} />GitHub</a>
            <a href="mailto:hello@caminuslabs.com"><Mail aria-hidden="true" size={16} />Contact</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
