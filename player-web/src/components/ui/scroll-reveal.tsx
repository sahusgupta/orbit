'use client';

import type { ReactNode } from 'react';
import { InView } from '@/src/components/vendor/motion-primitives/in-view';

type RevealDirection = 'up' | 'left' | 'right';

export function ScrollReveal({ children, direction = 'up' }: { children: ReactNode; direction?: RevealDirection }) {
  const visible = { opacity: 1, y: 0, clipPath: 'inset(0 0 0 0)' };
  const hidden = direction === 'left'
    ? { opacity: 0, y: 8, clipPath: 'inset(0 0 0 20px)' }
    : direction === 'right'
      ? { opacity: 0, y: 8, clipPath: 'inset(0 20px 0 0)' }
      : { opacity: 0, y: 24, clipPath: 'inset(0 0 0 0)' };

  return (
    <InView
      className="scroll-reveal"
      variants={{ hidden, visible }}
      viewOptions={{ once: true, amount: 0.14, margin: '0px 0px -10% 0px' }}
      revealDirection={direction}
      transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </InView>
  );
}
