'use client';

import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { Menu as MenuIcon, UserRound } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/src/auth/auth-context';

const destinations = [
  { href: '/games', label: 'Games' },
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/clubs', label: 'Clubs' },
  { href: '/me', label: 'My Orbit' }
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  const { status } = useAuth();
  const accountHref = status === 'signed-in' ? '/me/profile' : '/sign-in';
  const accountActive = pathname === '/me/profile' || pathname.startsWith('/sign-in');

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="site-brand" href="/" aria-label="Orbit home">
          <Image src="/orbit-logo.svg" width={42} height={42} alt="" priority />
          <span><strong>Orbit</strong><small>Live player network</small></span>
        </Link>
        <nav id="primary-navigation" className="primary-nav" aria-label="Primary navigation">
          {destinations.map((destination) => {
            const active = pathname.startsWith(destination.href);
            return <Link key={destination.href} href={destination.href} aria-current={active ? 'page' : undefined}>{destination.label}</Link>;
          })}
          <Link className="account-link" href={accountHref} aria-current={accountActive ? 'page' : undefined}>
            <UserRound aria-hidden="true" size={18} /><span>{status === 'signed-in' ? 'Profile' : 'Sign in'}</span>
          </Link>
        </nav>
        <MenuPrimitive.Root>
          <MenuPrimitive.Trigger className="menu-button" aria-label="Open navigation">
            <MenuIcon aria-hidden="true" size={21} />
          </MenuPrimitive.Trigger>
          <MenuPrimitive.Portal>
            <MenuPrimitive.Positioner className="mobile-menu-positioner" align="end" sideOffset={8}>
              <MenuPrimitive.Popup className="mobile-menu-popup" aria-label="Mobile navigation">
                {destinations.map((destination) => {
                  const active = pathname.startsWith(destination.href);
                  return <MenuPrimitive.LinkItem key={destination.href} className="mobile-menu-item" render={<Link href={destination.href} aria-current={active ? 'page' : undefined} />} closeOnClick>{destination.label}</MenuPrimitive.LinkItem>;
                })}
                <MenuPrimitive.LinkItem className="mobile-menu-item mobile-menu-item--account" render={<Link href={accountHref} aria-current={accountActive ? 'page' : undefined} />} closeOnClick>
                  <UserRound aria-hidden="true" size={18} /><span>{status === 'signed-in' ? 'Profile' : 'Sign in'}</span>
                </MenuPrimitive.LinkItem>
              </MenuPrimitive.Popup>
            </MenuPrimitive.Positioner>
          </MenuPrimitive.Portal>
        </MenuPrimitive.Root>
      </div>
    </header>
  );
}
