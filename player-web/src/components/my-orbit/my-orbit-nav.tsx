'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/me', label: 'Overview' },
  { href: '/me/clubs', label: 'My Clubs' },
  { href: '/me/games', label: 'My Games' },
  { href: '/me/tournaments', label: 'My Tournaments' },
  { href: '/me/profile', label: 'Profile' }
];

export function MyOrbitNav() {
  const pathname = usePathname();
  return <nav className="my-orbit-nav" aria-label="My Orbit sections">{items.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined}>{item.label}</Link>)}</nav>;
}
