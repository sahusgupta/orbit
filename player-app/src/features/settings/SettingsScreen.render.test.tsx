/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { Linking } from 'react-native';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nativeTextContrast } from '../../test-utils/nativeContrast';
import { colors } from '../../styles/playerTheme';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { SettingsScreen } from './SettingsScreen';
import { privacyPolicyUrl, supportUrl, termsOfServiceUrl } from '../../config/playerLinks';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const { nativePaintStyle } = await import('../../test-utils/nativeContrast');
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityRole, accessibilityLabel, accessibilityState, accessibilityHint, accessibilityLiveRegion, keyboardType: _keyboardType, placeholderTextColor: _placeholderTextColor, secureTextEntry, style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      style: { backgroundColor: 'transparent', ...nativePaintStyle(style) },
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
      ...(tag === 'input' && secureTextEntry ? { type: 'password' } : {}),
      ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
      ...(typeof accessibilityHint === 'string' ? { 'aria-description': accessibilityHint } : {}),
      ...(typeof accessibilityLiveRegion === 'string' ? { 'aria-live': accessibilityLiveRegion } : {}),
      ...(typeof accessibilityState === 'object' && accessibilityState !== null && 'expanded' in accessibilityState
        ? { 'aria-expanded': (accessibilityState as { expanded: boolean }).expanded } : {}),
      ...(typeof onPress === 'function' ? { onClick: onPress } : {}),
      ...(typeof onChangeText === 'function'
        ? { onInput: (event: { currentTarget: { value: string } }) => onChangeText(event.currentTarget.value) }
        : {})
    }, children as React.ReactNode);
  return {
    Linking: { openURL: vi.fn() },
    Platform: { OS: 'web' },
    Pressable: element('button'),
    Text: element('span'),
    TextInput: element('input'),
    View: element('div'),
    StyleSheet: { create: <T,>(styles: T) => styles }
  };
});

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span /> }));
vi.mock('../../components/PlayerFields', () => ({
  Chip: ({ disabled, label }: { disabled?: boolean; label: string }) => <button disabled={disabled}>{label}</button>,
  Field: ({ editable = true, label }: { editable?: boolean; label: string }) => <div data-editable={String(editable)} data-field={label}>{label}</div>
}));
vi.mock('../../components/PlayerPresentation', () => ({
  SimpleMenuRow: ({ title, onPress }: { title: string; onPress: () => void }) => <button role="button" aria-label={title} onClick={onPress}>{title}</button>
}));
vi.mock('../home/PlayerLandingExperience', () => ({ OrbitPlayerFaq: () => <span>Marketing FAQ</span>, OrbitPlayerFooter: () => <span>Marketing footer</span> }));

const identityStatus: PlayerIdentityStatus = {
  status: 'unverified', ageVerified: false, ageEligible: false, ageLevel: 0, minimumAge: 18,
  verifiedAt: null, capturedAt: null, failureCode: null, reviewStatus: 'not-started', verifiedDetails: null
};

describe('SettingsScreen local deletion action', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    container.style.backgroundColor = colors.canvas;
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const button = (label: string) => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.getAttribute('aria-label') === label || item.textContent === label);
    if (!found) throw new Error(`Expected ${label} action.`);
    return found;
  };

  it('keeps forms collapsed while identity, help, demo, and local deletion remain accessible', () => {
    const deletePlayerAccount = vi.fn();
    const onTryDemo = vi.fn();
    const connectPlayerAccount = vi.fn();
    const recoverPlayerAccount = vi.fn();
    const showIdentityVerification = vi.fn();
    const onOpenMatchPreferences = vi.fn();
    const setPlayer = vi.fn();
    act(() => {
      root.render(
        <SettingsScreen
          firebaseIdentity={null}
          authStatus="Local profile"
          playerAuthMethod="email"
          setPlayerAuthMethod={vi.fn()}
          playerAuthEmail=""
          setPlayerAuthEmail={vi.fn()}
          playerAuthPhone=""
          setPlayerAuthPhone={vi.fn()}
          playerAuthCode=""
          setPlayerAuthCode={vi.fn()}
          playerPhoneChallenge={false}
          playerAuthPassword=""
          setPlayerAuthPassword={vi.fn()}
          connectPlayerAccount={connectPlayerAccount}
          recoverPlayerAccount={recoverPlayerAccount}
          restartPlayerPhoneSignIn={vi.fn()}
          identityStatus={identityStatus}
          showIdentityVerification={showIdentityVerification}
          player={{ id: 'local-opaque-id', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] }}
          setPlayer={setPlayer}
          signOutPlayer={vi.fn()}
          deletePlayerAccount={deletePlayerAccount}
          onTryDemo={onTryDemo}
          onOpenMatchPreferences={onOpenMatchPreferences}
        />
      );
    });
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-field]')).toBeNull();
    ['Sign in', 'Edit profile', 'Preferences'].forEach((label) => expect(button(label).getAttribute('aria-expanded')).toBe('false'));
    ['Identity & age', 'Support', 'Privacy Policy', 'Terms of Service'].forEach((label) => expect(button(label)).toBeDefined());
    expect(container.textContent).not.toContain('Marketing FAQ');
    expect(container.textContent).not.toContain('Marketing footer');
    act(() => button('Match preferences').click());
    expect(onOpenMatchPreferences).toHaveBeenCalledOnce();
    expect(setPlayer).not.toHaveBeenCalled();
    expect(container.querySelector('[data-field]')).toBeNull();
    act(() => button('Identity & age').click());
    expect(showIdentityVerification).toHaveBeenCalledWith('settings');
    [
      ['Support', supportUrl], ['Privacy Policy', privacyPolicyUrl], ['Terms of Service', termsOfServiceUrl]
    ].forEach(([label, url]) => {
      act(() => button(label).click());
      expect(Linking.openURL).toHaveBeenCalledWith(url);
    });
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Delete local profile and data');
    expect(action).toBeDefined();
    expect(nativeTextContrast(action?.querySelector('span'))).toBeGreaterThanOrEqual(4.5);
    act(() => action?.click());
    expect(deletePlayerAccount).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Delete account');
    expect(Array.from(container.querySelectorAll('button')).some((button) => button.textContent === 'Phone number')).toBe(false);
    expect(container.textContent).not.toContain('Sign in or create account');
    act(() => button('Sign in').click());
    expect(button('Sign in').getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Sign in or create account');
    expect(connectPlayerAccount).not.toHaveBeenCalled();
    expect(recoverPlayerAccount).not.toHaveBeenCalled();
    act(() => {
      container.querySelector('input[aria-label="Email address"]')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      container.querySelector('input[aria-label="Password or passphrase"]')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(container.textContent).toContain('Enter a valid email address.');
    expect(container.textContent).toContain('Use at least 12 characters.');
    act(() => button('Sign in or create account').click());
    expect(connectPlayerAccount).toHaveBeenCalledOnce();
    act(() => button('Forgot password').click());
    expect(recoverPlayerAccount).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Send verification code');
    const demo = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try demo account');
    expect(demo?.getAttribute('role')).toBe('button');
    act(() => demo?.click());
    expect(onTryDemo).toHaveBeenCalledOnce();
    act(() => button('Preferences').click());
    expect(button('Preferences').getAttribute('aria-expanded')).toBe('true');
    expect(button('Sign in').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('[data-field="Preferred stakes"]')).not.toBeNull();
    act(() => button('Edit profile').click());
    expect(button('Preferences').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-field="Preferred stakes"]')).toBeNull();
    expect(container.querySelector('[data-field="Name"]')).not.toBeNull();
    expect(container.querySelector('[data-field="Email address"]')).not.toBeNull();
    act(() => button('Edit profile').click());
    expect(container.querySelector('[data-field]')).toBeNull();
  });

  it('shows the verified provider contact as read-only instead of editable profile contact fields', () => {
    const onTryDemo = vi.fn();
    const signOutPlayer = vi.fn();
    const deletePlayerAccount = vi.fn();
    act(() => {
      root.render(
        <SettingsScreen
          firebaseIdentity={{
            uid: 'player-1',
            email: 'verified@example.test',
            name: 'Alex',
            provider: 'email',
            verified: true
          }}
          authStatus="Connected"
          playerAuthMethod="email"
          setPlayerAuthMethod={vi.fn()}
          playerAuthEmail=""
          setPlayerAuthEmail={vi.fn()}
          playerAuthPhone=""
          setPlayerAuthPhone={vi.fn()}
          playerAuthCode=""
          setPlayerAuthCode={vi.fn()}
          playerPhoneChallenge={false}
          playerAuthPassword=""
          setPlayerAuthPassword={vi.fn()}
          connectPlayerAccount={vi.fn()}
          recoverPlayerAccount={vi.fn()}
          restartPlayerPhoneSignIn={vi.fn()}
          identityStatus={identityStatus}
          showIdentityVerification={vi.fn()}
          player={{
            id: 'player-1',
            name: 'Alex',
            email: 'stale@example.test',
            phone: '+15550001111',
            preferredGameIds: []
          }}
          setPlayer={vi.fn()}
          signOutPlayer={signOutPlayer}
          deletePlayerAccount={deletePlayerAccount}
          onTryDemo={onTryDemo}
        />
      );
    });

    expect(container.textContent).toContain('Sign-in email');
    expect(container.textContent).toContain('verified@example.test');
    expect(container.textContent).not.toContain('stale@example.test');
    expect(container.textContent).not.toContain('+15550001111');
    act(() => button('Edit profile').click());
    expect(container.querySelector('[data-field="Name"]')?.getAttribute('data-editable')).toBe('true');
    expect(container.querySelector('[data-field="Email address"]')).toBeNull();
    expect(container.querySelector('[data-field="Phone number"]')).toBeNull();
    const demo = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try demo account');
    act(() => demo?.click());
    expect(onTryDemo).toHaveBeenCalledOnce();
    expect(signOutPlayer).not.toHaveBeenCalled();
    act(() => button('Preferences').click());
    expect(button('1/2 NLH').disabled).toBe(false);
    act(() => button('Sign out').click());
    expect(signOutPlayer).toHaveBeenCalledOnce();
    act(() => button('Delete account').click());
    expect(deletePlayerAccount).toHaveBeenCalledOnce();
  });

  it('keeps connected profile inputs disabled until same-account hydration completes', () => {
    act(() => {
      root.render(
        <SettingsScreen
          firebaseIdentity={{
            uid: 'player-1', email: 'verified@example.test', name: 'Alex', provider: 'email', verified: true
          }}
          authStatus="Connected"
          playerAuthMethod="email"
          setPlayerAuthMethod={vi.fn()}
          playerAuthEmail=""
          setPlayerAuthEmail={vi.fn()}
          playerAuthPhone=""
          setPlayerAuthPhone={vi.fn()}
          playerAuthCode=""
          setPlayerAuthCode={vi.fn()}
          playerPhoneChallenge={false}
          playerAuthPassword=""
          setPlayerAuthPassword={vi.fn()}
          connectPlayerAccount={vi.fn()}
          recoverPlayerAccount={vi.fn()}
          restartPlayerPhoneSignIn={vi.fn()}
          identityStatus={identityStatus}
          profileEditingReady={false}
          showIdentityVerification={vi.fn()}
          player={{ id: 'player-1', name: 'Locally restored', email: 'verified@example.test', preferredGameIds: ['nlh'] }}
          setPlayer={vi.fn()}
          signOutPlayer={vi.fn()}
          deletePlayerAccount={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Restoring your signed-in profile');
    expect(container.querySelector('[data-field]')).toBeNull();
    act(() => button('Edit profile').click());
    expect(container.querySelector('[data-field="Name"]')?.getAttribute('data-editable')).toBe('false');
    expect(container.querySelector('[data-field="Home area"]')?.getAttribute('data-editable')).toBe('false');
    act(() => button('Preferences').click());
    expect(container.querySelector('[data-field="Name"]')).toBeNull();
    expect(container.querySelector('[data-field="Preferred stakes"]')?.getAttribute('data-editable')).toBe('false');
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '1/2 NLH')?.disabled).toBe(true);
  });

  it('prompts for an explicit country code and normalizes accepted phone input', () => {
    const setPlayerAuthPhone = vi.fn();
    act(() => {
      root.render(
        <SettingsScreen
          firebaseIdentity={null}
          authStatus="Sign in"
          playerAuthMethod="phone"
          setPlayerAuthMethod={vi.fn()}
          playerAuthEmail=""
          setPlayerAuthEmail={vi.fn()}
          playerAuthPhone=""
          setPlayerAuthPhone={setPlayerAuthPhone}
          playerAuthCode=""
          setPlayerAuthCode={vi.fn()}
          playerPhoneChallenge={false}
          playerAuthPassword=""
          setPlayerAuthPassword={vi.fn()}
          connectPlayerAccount={vi.fn()}
          recoverPlayerAccount={vi.fn()}
          restartPlayerPhoneSignIn={vi.fn()}
          identityStatus={identityStatus}
          showIdentityVerification={vi.fn()}
          player={{ id: 'local-opaque-id', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] }}
          setPlayer={vi.fn()}
          signOutPlayer={vi.fn()}
          deletePlayerAccount={vi.fn()}
        />
      );
    });

    act(() => button('Sign in').click());
    const phoneInput = container.querySelector('input[placeholder="+1 555 555 0123"]') as HTMLInputElement;
    expect(phoneInput).not.toBeNull();
    expect(container.textContent).toContain('Start with + and the country code.');
    act(() => {
      phoneInput.value = '+44 20 7946 0958';
      phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(setPlayerAuthPhone).toHaveBeenCalledWith('+442079460958');
  });
});
