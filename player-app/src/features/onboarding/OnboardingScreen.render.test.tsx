/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '../../domain/playerSync';
import { OnboardingScreen } from './OnboardingScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({
    accessibilityRole,
    accessibilityState,
    children,
    disabled,
    onPress,
    style: _style,
    ...props
  }: Record<string, unknown>) => ReactModule.createElement(tag, {
    ...props,
    ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
    ...(
      typeof accessibilityState === 'object' && accessibilityState !== null && 'checked' in accessibilityState
        ? { 'aria-checked': (accessibilityState as { checked?: boolean }).checked }
        : {}
    ),
    ...(typeof disabled === 'boolean' ? { disabled } : {}),
    ...(typeof onPress === 'function' ? { onClick: onPress } : {})
  }, children as React.ReactNode);

  class AnimatedValue {
    setValue() {}
    interpolate() { return 0; }
  }

  return {
    Animated: {
      Value: AnimatedValue,
      View: element('div'),
      spring: () => ({ start: (complete?: () => void) => complete?.() }),
      timing: () => ({ start: (complete?: () => void) => complete?.() })
    },
    Easing: { cubic: {}, out: () => ({}) },
    Platform: { OS: 'ios' },
    Pressable: element('button'),
    ScrollView: element('div'),
    Text: element('span'),
    TextInput: element('input'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span data-testid="icon" /> }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('react-native-safe-area-context', async () => {
  const ReactModule = await import('react');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children)
  };
});
vi.mock('../../components/PlayerFields', () => ({
  Field: ({ label }: { label: string }) => <input aria-label={label} />
}));
vi.mock('../home/PlayerLandingExperience', () => ({ PlayerAmbientFlow: () => null }));

const validDraft: PlayerAccount = {
  id: 'local-player',
  name: 'Alex',
  email: 'alex@example.test',
  phone: '',
  homeLocation: 'Austin',
  preferredGameIds: []
};

describe('OnboardingScreen adult declaration gate', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('blocks completion until the player checks the 18+ declaration', () => {
    const onComplete = vi.fn();
    function Harness() {
      const [draftPlayer, setDraftPlayer] = useState(validDraft);
      return (
        <OnboardingScreen
          draftPlayer={draftPlayer}
          onboardingStep={3}
          setDraftPlayer={setDraftPlayer}
          setOnboardingStep={vi.fn()}
          onComplete={onComplete}
        />
      );
    }

    act(() => root.render(<Harness />));

    const completion = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Start exploring');
    const declaration = container.querySelector('button[role="checkbox"]') as HTMLButtonElement | null;
    expect(completion?.disabled).toBe(true);
    expect(declaration?.getAttribute('aria-checked')).toBe('false');

    act(() => completion?.click());
    expect(onComplete).not.toHaveBeenCalled();

    act(() => declaration?.click());
    expect(declaration?.getAttribute('aria-checked')).toBe('true');
    expect(completion?.disabled).toBe(false);

    act(() => completion?.click());
    expect(onComplete).toHaveBeenCalledOnce();
  });
});
