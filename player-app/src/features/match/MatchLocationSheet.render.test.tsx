/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchLocationSheet } from './MatchLocationSheet';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, disabled, accessibilityLabel, accessibilityRole }: {
    children?: React.ReactNode; onPress?: () => void; disabled?: boolean; accessibilityLabel?: string; accessibilityRole?: string;
  }) => ReactModule.createElement(tag, { onClick: onPress, disabled, 'aria-label': accessibilityLabel, role: accessibilityRole }, children);
  return { Platform: { OS: 'ios' }, View: element('div'), Text: element('span'), Pressable: element('button'),
    TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (value: string) => void; accessibilityLabel: string }) =>
      <input value={value} onChange={(event) => onChangeText(event.currentTarget.value)} aria-label={accessibilityLabel} />,
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});
vi.mock('../../components/PlayerPresentation', () => ({
  FiltersBottomSheet: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? <div role="dialog">{children}</div> : null
}));
vi.mock('../../components/MapView', () => ({
  PROVIDER_GOOGLE: 'google', Marker: () => null,
  default: ({ initialRegion, onPress, children }: { initialRegion: { latitude: number; longitude: number }; onPress: (event: { nativeEvent: { coordinate: { latitude: number; longitude: number } } }) => void; children?: React.ReactNode }) =>
    <button aria-label="Test map point" data-center={`${initialRegion.latitude},${initialRegion.longitude}`} onClick={() => onPress({ nativeEvent: { coordinate: { latitude: -33, longitude: 151 } } })}>{children}</button>
}));

describe('Manual and foreground Match location sheet', () => {
  let root: Root;
  let container: HTMLDivElement;
  let props: React.ComponentProps<typeof MatchLocationSheet>;
  const render = (overrides: Partial<typeof props> = {}) => act(() => root.render(<MatchLocationSheet {...props} {...overrides} />));
  const button = (label: string) => {
    const match = Array.from(container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label);
    if (!match) throw new Error(`Missing ${label}`);
    return match;
  };
  const edit = (label: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
    if (!input) throw new Error(`Missing ${label}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    act(() => { setter?.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  beforeEach(() => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
    props = { visible: true, onClose: vi.fn(), clubs: [], controller: { origin: null, originLabel: '', source: null, ready: true, busy: false, error: '',
      selectManual: vi.fn(async () => true), useDevice: vi.fn(async () => true), clear: vi.fn(async () => true) } };
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  it('requires an explicit GPS action, displays denial, and retains manual entry', async () => {
    render({ controller: { ...props.controller, error: 'Permission denied. Choose manually.' } });
    expect(props.controller.useDevice).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Permission denied');
    await act(async () => button('Use my device location').click());
    expect(props.controller.useDevice).toHaveBeenCalledOnce();
    expect(props.onClose).toHaveBeenCalledOnce();
    expect(container.querySelector('input[aria-label="Search latitude"]')).not.toBeNull();
  });
  it('validates manual coordinates instead of inventing a default origin', async () => {
    render();
    await act(async () => button('Use selected search point').click());
    expect(props.controller.selectManual).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter both coordinates');
    edit('Search latitude', '30'); edit('Search longitude', '-181');
    await act(async () => button('Use selected search point').click());
    expect(container.textContent).toContain('Latitude must be');
    expect(props.controller.selectManual).not.toHaveBeenCalled();
    edit('Search longitude', '-97');
    await act(async () => button('Use selected search point').click());
    expect(props.controller.selectManual).toHaveBeenCalledExactlyOnceWith({ latitude: 30, longitude: -97 });
  });
  it('opens an explicitly neutral map only on request and saves an explicitly selected point', async () => {
    render();
    expect(container.querySelector('[data-center]')).toBeNull();
    act(() => button('Choose a point on the map').click());
    expect(button('Test map point').getAttribute('data-center')).toBe('0,0');
    expect(container.textContent).toContain('starting view is not your location');
    act(() => button('Test map point').click());
    await act(async () => button('Use selected search point').click());
    expect(props.controller.selectManual).toHaveBeenCalledExactlyOnceWith({ latitude: -33, longitude: 151 });
  });
  it('hides device location in demo and disables clear/save while restoring or busy', () => {
    render({ demoMode: true });
    expect(container.textContent).toContain('The sample account uses manual search points. Device location stays off.');
    expect(container.textContent).not.toMatch(/\bdemo\b/i);
    expect(container.querySelector('[aria-label="Use my device location"]')).toBeNull();
    render({ controller: { ...props.controller, ready: false } });
    expect(button('Use my device location').disabled).toBe(true);
    expect(button('Clear search location').disabled).toBe(true);
    expect(button('Use selected search point').disabled).toBe(true);
    render({ controller: { ...props.controller, busy: true } });
    expect(button('Clear search location').disabled).toBe(true);
  });
});
