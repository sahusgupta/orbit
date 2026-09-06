/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InsetChangedEvent } from 'react-native-safe-area-context';
import App from './App';

const native = vi.hoisted(() => ({ events: new Set<(event: InsetChangedEvent) => void>() }));

vi.mock('react-native', () => ({
  Dimensions: { get: () => ({ width: 393, height: 852 }) },
  StyleSheet: { create: <T,>(styles: T) => styles },
  View: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Pressable: ({ children, onPress }: React.PropsWithChildren<{ onPress: () => void }>) => <button onClick={onPress}>{children}</button>
}));
vi.mock('./node_modules/react-native-safe-area-context/src/NativeSafeAreaProvider', () => ({
  NativeSafeAreaProvider: ({ children, onInsetsChange }: React.PropsWithChildren<{ onInsetsChange: (event: InsetChangedEvent) => void }>) => {
    React.useEffect(() => {
      native.events.add(onInsetsChange);
      return () => { native.events.delete(onInsetsChange); };
    }, [onInsetsChange]);
    return <div>{children}</div>;
  }
}));
vi.mock('react-native-safe-area-context', async () => ({
  ...await import('./node_modules/react-native-safe-area-context/src/SafeAreaContext'),
  initialWindowMetrics: {
    frame: { x: 0, y: 0, width: 393, height: 852 },
    insets: { top: 59, right: 0, bottom: 34, left: 0 }
  }
}));
vi.mock('./src/PlayerApp', async () => {
  const { SafeAreaProvider, useSafeAreaInsets } = await import('react-native-safe-area-context');
  function Content() {
    const [failed, setFailed] = React.useState(false);
    const insets = useSafeAreaInsets();
    if (failed) throw new Error('synthetic rendering failure');
    return <><span>Local profile: top inset {insets.top}</span><button onClick={() => setFailed(true)}>Simulate render error</button></>;
  }
  return { default: () => <SafeAreaProvider><Content /></SafeAreaProvider> };
});

describe('Player app root safe area and recovery', () => {
  let container: HTMLDivElement;
  let root: Root;
  const deliverInsets = (top: number) => {
    for (const callback of native.events) callback({ nativeEvent: {
      frame: { x: 0, y: 0, width: 393, height: 852 },
      insets: { top, right: 0, bottom: 34, left: 0 }
    } });
  };
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    native.events.clear();
    vi.restoreAllMocks();
  });

  it('renders after native inset delivery and follows later window changes', () => {
    act(() => root.render(<App />));
    act(() => deliverInsets(59));
    expect(container.textContent).toContain('Local profile: top inset 59');
    act(() => deliverInsets(20));
    expect(container.textContent).toContain('Local profile: top inset 20');
  });

  it('renders the nested screen from initial window metrics when its first native inset event is delayed', () => {
    act(() => root.render(<App />));
    expect(container.textContent).toContain('Local profile: top inset 59');
  });

  it('retains the recovery boundary and can restore the app view after a render failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => root.render(<App />));
    act(() => deliverInsets(59));
    act(() => container.querySelector('button')!.click());
    expect(container.textContent).toContain('Orbit Player needs to recover.');
    expect(container.textContent).toContain('Your account was not deleted.');
    act(() => container.querySelector('button')!.click());
    act(() => deliverInsets(59));
    expect(container.textContent).toContain('Local profile: top inset 59');
  });
});
