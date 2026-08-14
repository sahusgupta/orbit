import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmbientFlow } from '@/src/components/shell/ambient-flow';
import { ScrollReveal } from '@/src/components/ui/scroll-reveal';

function setReducedMotion(matches: boolean) {
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  })));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Orbit web motion', () => {
  it('moves decorative background layers at restrained scroll ratios', () => {
    setReducedMotion(false);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(480);
    const { container } = render(<AmbientFlow />);
    const flow = container.querySelector<HTMLElement>('.ambient-flow');

    expect(flow).toHaveAttribute('aria-hidden', 'true');
    expect(flow?.style.getPropertyValue('--flow-near-y')).toBe('-22px');
    expect(flow?.style.getPropertyValue('--flow-far-y')).toBe('12px');
    expect(container.querySelectorAll('.ambient-flow > span')).toHaveLength(3);
  });

  it('leaves the ambient field static when reduced motion is requested', () => {
    setReducedMotion(true);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(900);
    const { container } = render(<AmbientFlow />);
    const flow = container.querySelector<HTMLElement>('.ambient-flow');

    expect(flow?.style.getPropertyValue('--flow-near-y')).toBe('');
    expect(flow?.style.getPropertyValue('--flow-far-y')).toBe('');
  });

  it('uses a directional Motion Primitives in-view reveal with reduced-motion support', () => {
    setReducedMotion(true);
    const { container } = render(<ScrollReveal direction="right"><section>Current tournaments</section></ScrollReveal>);
    const host = container.querySelector('.scroll-reveal');
    expect(host).toHaveAttribute('data-motion-primitive', 'in-view');
    expect(host).toHaveAttribute('data-reveal-direction', 'right');
  });
});
