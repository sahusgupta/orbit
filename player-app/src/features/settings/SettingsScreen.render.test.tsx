/**
 * @vitest-environment jsdom
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerIdentityStatus } from '../../data/orbitSyncApi';
import { SettingsScreen } from './SettingsScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({ children, onPress, onChangeText, accessibilityRole, style: _style, ...props }: Record<string, unknown>) =>
    ReactModule.createElement(tag, {
      ...props,
      ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
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
  SimpleMenuRow: ({ title }: { title: string }) => <button>{title}</button>
}));
vi.mock('../home/PlayerLandingExperience', () => ({ OrbitPlayerFaq: () => null, OrbitPlayerFooter: () => null }));

const identityStatus: PlayerIdentityStatus = {
  status: 'unverified', ageVerified: false, ageEligible: false, ageLevel: 0, minimumAge: 18,
  verifiedAt: null, capturedAt: null, failureCode: null, reviewStatus: 'not-started', verifiedDetails: null
};

describe('SettingsScreen local deletion action', () => {
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

  it('labels local deletion explicitly and routes the action to the deletion workflow', () => {
    const deletePlayerAccount = vi.fn();
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
          connectPlayerAccount={vi.fn()}
          recoverPlayerAccount={vi.fn()}
          restartPlayerPhoneSignIn={vi.fn()}
          identityStatus={identityStatus}
          showIdentityVerification={vi.fn()}
          player={{ id: 'local-opaque-id', name: 'Alex', email: 'alex@example.test', preferredGameIds: [] }}
          setPlayer={vi.fn()}
          signOutPlayer={vi.fn()}
          deletePlayerAccount={deletePlayerAccount}
        />
      );
    });
    const action = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Delete local profile and data');
    expect(action).toBeDefined();
    act(() => action?.click());
    expect(deletePlayerAccount).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain('Delete account');
  });

  it('shows the verified provider contact as read-only instead of editable profile contact fields', () => {
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
          signOutPlayer={vi.fn()}
          deletePlayerAccount={vi.fn()}
        />
      );
    });

    expect(container.textContent).toContain('Sign-in email');
    expect(container.textContent).toContain('verified@example.test');
    expect(container.textContent).not.toContain('stale@example.test');
    expect(container.textContent).not.toContain('+15550001111');
    expect(container.querySelector('[data-field="Email address"]')).toBeNull();
    expect(container.querySelector('[data-field="Phone number"]')).toBeNull();
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
    expect(container.querySelector('[data-field="Name"]')?.getAttribute('data-editable')).toBe('false');
    expect(container.querySelector('[data-field="Home area"]')?.getAttribute('data-editable')).toBe('false');
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
