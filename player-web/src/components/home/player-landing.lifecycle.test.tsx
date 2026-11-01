import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StrictMode, type HTMLAttributes, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlayerLanding from './player-landing';

type DragEnd = (event: unknown, info: { offset: { x: number } }) => void;
type MotionProps = Omit<HTMLAttributes<HTMLElement>, 'onDragEnd'> & {
  drag?: string;
  onDragEnd?: DragEnd;
};

const motionState = vi.hoisted((): {
  dragEnd: DragEnd | undefined;
} => ({ dragEnd: undefined }));

// Test the landing's own lifecycle without Motion's unrelated animation clocks.
// Real children, refs, DOM attributes and the real drag callback remain intact.
vi.mock('motion/react', async () => {
  const { createElement, forwardRef, useEffect } = await import('react');
  const motionOnlyProps = new Set([
    'initial', 'animate', 'exit', 'transition', 'whileInView', 'viewport',
    'whileHover', 'dragConstraints', 'dragElastic'
  ]);
  const element = (tag: string) => {
    const MotionElement = forwardRef<HTMLElement, MotionProps>(function MotionElement(
      { children, drag, onDragEnd, ...attributes }, ref
    ) {
      useEffect(() => {
        if (drag !== 'x' || !onDragEnd) return;
        motionState.dragEnd = onDragEnd;
        return () => {
          if (motionState.dragEnd === onDragEnd) motionState.dragEnd = undefined;
        };
      }, [drag, onDragEnd]);
      const domAttributes = Object.fromEntries(
        Object.entries(attributes).filter(([name]) => !motionOnlyProps.has(name))
      );
      return createElement(tag, { ...domAttributes, ref }, children);
    });
    MotionElement.displayName = `TestMotion(${tag})`;
    return MotionElement;
  };
  return {
    AnimatePresence: ({ children }: PropsWithChildren) => children,
    motion: {
      a: element('a'), circle: element('circle'), div: element('div'),
      h1: element('h1'), h2: element('h2'), header: element('header'),
      line: element('line'), p: element('p')
    },
    useMotionValue: (value: number) => value,
    useTransform: () => 0,
    useReducedMotion: () => true
  };
});

const headlines = [
  'Published games, all in one place.',
  'Swipe right. Preview a request.',
  'Venue-reported. Check your current place.',
  'Participating clubs. One place.'
];
const cardAvailability = [
  'Availability when published', 'Status when published',
  'Waitlist when published', 'Venue data only'
];
let geometry: { top: number; height: number };
let geometryReads: number;
let frames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

beforeEach(() => {
  vi.useFakeTimers();
  geometry = { top: 0, height: 5_000 };
  geometryReads = 0;
  frames = new Map();
  nextFrameId = 0;
  motionState.dragEnd = undefined;
  vi.stubGlobal('innerHeight', 1_000);
  vi.stubGlobal('scrollY', 0);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.id !== 'how-it-works') return new DOMRect();
    geometryReads += 1;
    return new DOMRect(0, geometry.top, 1_000, geometry.height);
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.id === 'how-it-works' ? geometry.height : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function frame() {
  const pending = Array.from(frames.values());
  frames.clear();
  act(() => {
    for (const callback of pending) callback(16);
  });
}

function scroll(top: number, scrollY = 0) {
  geometry.top = top;
  vi.stubGlobal('scrollY', scrollY);
  fireEvent.scroll(window);
}

function expectSection(index: number) {
  expect(screen.getByRole('heading', { level: 2,
    name: (name) => name.replace(/\s+/g, ' ') === headlines[index] })).toBeInTheDocument();
}

function expectCard(index: number) {
  const card = document.querySelector('#how-it-works .touch-none.select-none');
  if (!(card instanceof HTMLElement)) throw new Error('No real swipe-card element is mounted.');
  expect(within(card).getByText(cardAvailability[index])).toBeInTheDocument();
  for (const [otherIndex, availability] of cardAvailability.entries()) {
    if (otherIndex !== index) expect(within(card).queryByText(availability)).not.toBeInTheDocument();
  }
}

function swipe(offset: number) {
  const dragEnd = motionState.dragEnd;
  if (!dragEnd) throw new Error('The current story section has no mounted swipe card.');
  act(() => dragEnd(undefined, { offset: { x: offset } }));
}

function advance(milliseconds: number) {
  act(() => vi.advanceTimersByTime(milliseconds));
}

function mountSwipeStory() {
  geometry.top = -1_000;
  return render(<PlayerLanding />);
}

describe('landing scroll lifecycle characterization', () => {
  it('measures the restored position synchronously inside the initial effect and owns one passive listener', () => {
    geometry.top = -2_000;
    vi.stubGlobal('scrollY', 41);
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<PlayerLanding />);

    expect(geometryReads).toBe(1);
    expect(frames.size).toBe(0);
    expectSection(2);
    expect(view.container.querySelector('.player-landing__nav')).toHaveClass('backdrop-blur-md');
    const registrations = add.mock.calls.filter(([event]) => event === 'scroll');
    expect(registrations).toHaveLength(1);
    expect(registrations[0][2]).toEqual({ passive: true });
    view.unmount();
    expect(remove).toHaveBeenCalledWith('scroll', registrations[0][1]);
  });

  it('updates navigation synchronously only above the strict 40-pixel threshold', () => {
    const view = render(<PlayerLanding />);
    const navigation = view.container.querySelector('.player-landing__nav');
    for (const [position, shadow] of [[39, false], [40, false], [41, true], [40, false]] as const) {
      scroll(0, position);
      if (shadow) expect(navigation).toHaveClass('backdrop-blur-md');
      else expect(navigation).not.toHaveClass('backdrop-blur-md');
      frame();
    }
  });

  it.each([
    [100, 0], [0, 0], [-999, 0], [-1_000, 1], [-1_999, 1],
    [-2_000, 2], [-2_999, 2], [-3_000, 3], [-4_000, 3], [-9_000, 3]
  ])('selects the same story at top=%s after the browser frame', (top, section) => {
    render(<PlayerLanding />);
    scroll(top);
    frame();
    expectSection(section);
  });

  it.each([1_000, 900])('keeps the current section when story height %s has no positive scroll range', (height) => {
    render(<PlayerLanding />);
    scroll(-2_000);
    frame();
    expectSection(2);
    geometry.height = height;
    scroll(0, 41);
    frame();
    expectSection(2);
    expect(document.querySelector('.player-landing__nav')).toHaveClass('backdrop-blur-md');
  });

  it('settles a burst of raw scroll events at its final geometry', () => {
    render(<PlayerLanding />);
    const before = geometryReads;
    for (let index = 0; index < 100; index += 1) scroll(-index * 31);
    frame();
    expectSection(3);
    // Report the baseline cost without making repeated work a behavior contract.
    console.info(JSON.stringify({ measurement: 'landing-100-scroll-events',
      rawEvents: 100, geometryReads: geometryReads - before }));
  });
});

describe('landing swipe lifecycle characterization', () => {
  it.each([-100, -99, 0, 99, 100])('does not accept drag offset %s', (offset) => {
    mountSwipeStory();
    expectCard(0);
    swipe(offset);
    advance(2_500);
    expectCard(0);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
  });

  it('shows a right-swipe preview immediately, advances at 300ms, and hides the preview at 2400ms', () => {
    mountSwipeStory();
    swipe(101);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(299);
    expectCard(0);
    advance(1);
    expectCard(1);
    advance(2_099);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
    expect(screen.getByText('drag the card to try it')).toBeInTheDocument();
  });

  it('advances a left swipe at 300ms without showing a preview', () => {
    mountSwipeStory();
    swipe(-101);
    advance(299);
    expectCard(0);
    advance(1);
    expectCard(1);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
  });

  it('keeps both delayed card advances and the first right-swipe expiry when right swipes overlap', () => {
    mountSwipeStory();
    swipe(101);
    advance(100);
    swipe(101);
    advance(199);
    expectCard(0);
    advance(1);
    expectCard(1);
    advance(99);
    expectCard(1);
    advance(1);
    expectCard(2);
    advance(1_999);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
    advance(100);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
  });

  it('does not clear a right-swipe preview when a left swipe follows it', () => {
    mountSwipeStory();
    swipe(101);
    advance(100);
    swipe(-101);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(199);
    expectCard(0);
    advance(1);
    expectCard(1);
    advance(100);
    expectCard(2);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(1_999);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
  });

  it('preserves the parent-owned preview lifetime while leaving and returning to the swipe section', () => {
    mountSwipeStory();
    swipe(101);
    advance(100);
    scroll(0);
    frame();
    expectSection(0);
    advance(2_299);
    scroll(-1_000);
    frame();
    expectSection(1);
    expectCard(1);
    expect(screen.getByText('Request preview')).toBeInTheDocument();
    advance(1);
    expect(screen.queryByText('Request preview')).not.toBeInTheDocument();
  });
});

describe('landing scheduling resource regressions', () => {
  it('performs one geometry scan for a 100-event burst at its next frame', () => {
    render(<PlayerLanding />);
    const before = geometryReads;
    for (let index = 0; index < 100; index += 1) scroll(-index * 31);
    expect(frames.size).toBe(1);
    expect(geometryReads).toBe(before);
    frame();
    expect(frames.size).toBe(0);
    expect(geometryReads - before).toBe(1);
    expectSection(3);
  });

  it('can schedule a fresh geometry scan after each completed frame', () => {
    render(<PlayerLanding />);
    const before = geometryReads;
    scroll(-1_000);
    expect(frames.size).toBe(1);
    frame();
    expectSection(1);
    expect(geometryReads - before).toBe(1);
    scroll(-2_000);
    scroll(-3_000);
    expect(frames.size).toBe(1);
    expect(geometryReads - before).toBe(1);
    frame();
    expectSection(3);
    expect(geometryReads - before).toBe(2);
    expect(frames.size).toBe(0);
  });

  it('reads current geometry when the frame runs even if layout changes without another scroll', () => {
    render(<PlayerLanding />);
    scroll(-1_000);
    geometry.top = -3_000;
    frame();
    expectSection(3);
  });

  it('cancels its pending frame with handle zero and removes its listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<PlayerLanding />);
    const registrations = add.mock.calls.filter(([event]) => event === 'scroll');
    expect(registrations).toHaveLength(1);
    scroll(-1_000);
    expect(frames.has(0)).toBe(true);
    const beforeUnmount = geometryReads;
    view.unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(0);
    expect(frames.size).toBe(0);
    expect(remove).toHaveBeenCalledWith('scroll', registrations[0][1]);
    fireEvent.scroll(window);
    frame();
    expect(geometryReads).toBe(beforeUnmount);
    expect(frames.size).toBe(0);
  });

  it('clears all still-pending swipe timeouts when the entire landing unmounts', () => {
    const view = mountSwipeStory();
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    swipe(101);
    advance(100);
    swipe(-101);
    const owned = scheduled.mock.calls.flatMap(([, delay], index) => {
      const result = scheduled.mock.results[index];
      return (delay === 300 || delay === 2_400) && result?.type === 'return' ? [result.value] : [];
    });
    expect(owned).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(3);
    view.unmount();
    for (const timer of owned) {
      expect(cleared.mock.calls.some(([handle]) => handle === timer)).toBe(true);
    }
    expect(vi.getTimerCount()).toBe(0);
    advance(3_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retires completed swipe handles instead of clearing expired timers on unmount', () => {
    const view = mountSwipeStory();
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    swipe(101);
    const owned = scheduled.mock.calls.flatMap(([, delay], index) => {
      const result = scheduled.mock.results[index];
      return (delay === 300 || delay === 2_400) && result?.type === 'return'
        ? [{ delay, handle: result.value }] : [];
    });
    expect(owned).toHaveLength(2);
    advance(300);
    expectCard(1);
    expect(vi.getTimerCount()).toBe(1);
    cleared.mockClear();
    view.unmount();
    for (const timer of owned) {
      const wasCleared = cleared.mock.calls.some(([handle]) => handle === timer.handle);
      expect(wasCleared).toBe(timer.delay !== 300);
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('owns one live scroll listener and frame and clears work through StrictMode effect replay', () => {
    geometry.top = -1_000;
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = render(<StrictMode><PlayerLanding /></StrictMode>);
    const registrations = add.mock.calls.filter(([event]) => event === 'scroll');
    expect(registrations).toHaveLength(2);
    expect(remove.mock.calls.filter(([event]) => event === 'scroll')).toHaveLength(1);
    expect(geometryReads).toBe(2);
    const before = geometryReads;
    scroll(-1_000);
    scroll(-1_001);
    expect(frames.size).toBe(1);
    frame();
    expect(geometryReads - before).toBe(1);
    expectCard(0);
    const scheduled = vi.spyOn(globalThis, 'setTimeout');
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const timersBeforeSwipe = vi.getTimerCount();
    swipe(101);
    const timersAfterSwipe = vi.getTimerCount();
    const owned = scheduled.mock.calls.flatMap(([, delay], index) => {
      const result = scheduled.mock.results[index];
      return (delay === 300 || delay === 2_400) && result?.type === 'return' ? [result.value] : [];
    });
    console.info(JSON.stringify({ measurement: 'landing-strict-mode-swipe-timeouts',
      timersBeforeSwipe, timersAfterSwipe, createdTimeoutDelays: scheduled.mock.calls.map(([, delay]) => delay),
      ownedSwipeHandles: owned.length }));
    expect(owned).toHaveLength(2);
    scroll(0);
    expect(frames.size).toBe(1);
    const beforeUnmount = geometryReads;
    const timersBeforeUnmount = vi.getTimerCount();
    view.unmount();
    const clearedOwnedHandles = owned.filter((timer) => cleared.mock.calls.some(([handle]) => handle === timer));
    console.info(JSON.stringify({ measurement: 'landing-strict-mode-unmount', timersBeforeUnmount,
      timersAfterUnmount: vi.getTimerCount(), clearedOwnedSwipeHandles: clearedOwnedHandles.length }));
    expect(clearedOwnedHandles).toHaveLength(2);
    expect(remove.mock.calls.filter(([event]) => event === 'scroll')).toHaveLength(2);
    expect(remove).toHaveBeenCalledWith('scroll', registrations[1][1]);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.scroll(window);
    frame();
    advance(3_000);
    expect(geometryReads).toBe(beforeUnmount);
    expect(frames.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
