import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { MyOrbitNav } from '@/src/components/my-orbit/my-orbit-nav';

export const metadata: Metadata = { description: 'Private Orbit player commitments and profile.', robots: { index: false, follow: false } };

export default function MyOrbitLayout({ children }: { children: ReactNode }) {
  return <div className="my-orbit-shell"><header className="my-orbit-header"><p className="eyebrow">Private player space</p><h1>My Orbit</h1></header><MyOrbitNav />{children}</div>;
}
