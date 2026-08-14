'use client';

import { useEffect, useRef } from 'react';
import { HaikeiLayeredWaves } from '@/src/components/vendor/haikei/layered-waves';

export function AmbientFlow() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!host || reducedMotion.matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollTop = Math.max(window.scrollY, 0);
      host.style.setProperty('--flow-near-y', `${Math.round(scrollTop * -0.045)}px`);
      host.style.setProperty('--flow-far-y', `${Math.round(scrollTop * 0.025)}px`);
    };
    const requestUpdate = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);
    return () => {
      window.removeEventListener('scroll', requestUpdate);
      window.removeEventListener('resize', requestUpdate);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="ambient-flow" aria-hidden="true" ref={hostRef}>
      <HaikeiLayeredWaves />
    </div>
  );
}
