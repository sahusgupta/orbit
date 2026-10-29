/**
 * @vitest-environment jsdom
 */
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '../../domain/playerSync';
import { adultDeclarationVersion } from '../../domain/playerOnboarding';
import { OnboardingScreen, type OnboardingAccountConnection } from './OnboardingScreen';

vi.mock('react-native', async () => {
  const ReactModule = await import('react');
  const element = (tag: string) => ({
    accessibilityRole,
    accessibilityLabel,
    accessibilityState,
    children,
    disabled,
    onPress,
    style: _style,
    ...props
  }: Record<string, unknown>) => ReactModule.createElement(tag, {
    ...props,
    ...(typeof accessibilityRole === 'string' ? { role: accessibilityRole } : {}),
    ...(typeof accessibilityLabel === 'string' ? { 'aria-label': accessibilityLabel } : {}),
    ...(
      typeof accessibilityState === 'object' && accessibilityState !== null && 'disabled' in accessibilityState
        ? { 'aria-disabled': (accessibilityState as { disabled?: boolean }).disabled }
        : {}
    ),
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
    KeyboardAvoidingView: element('div'),
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

  it('opens the explicit demo without creating or changing a player profile', () => {
    const onTryDemo = vi.fn();
    const onComplete = vi.fn();
    const setDraftPlayer = vi.fn();
    const setOnboardingStep = vi.fn();
    act(() => root.render(<OnboardingScreen
      draftPlayer={{ ...validDraft, name: '', email: '' }} onboardingStep={0}
      setDraftPlayer={setDraftPlayer} setOnboardingStep={setOnboardingStep}
      onComplete={onComplete} onTryDemo={onTryDemo}
    />));

    const demo = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try sample account');
    expect(demo?.getAttribute('role')).toBe('button');
    expect(demo?.getAttribute('aria-label')).toBe('Try sample account');
    expect(demo?.disabled).toBe(false);
    expect(container.textContent).not.toContain('Explore fictional games at different locations. No sign-in required.');
    act(() => demo?.click());
    expect(onTryDemo).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(setDraftPlayer).not.toHaveBeenCalled();
    expect(setOnboardingStep).not.toHaveBeenCalled();
  });

  it('starts with account creation, demo, and returning-account choices without completing a local profile', () => {
    const onComplete = vi.fn();
    const onTryDemo = vi.fn();
    const connection = accountConnection();
    act(() => root.render(<OnboardingScreen draftPlayer={validDraft} onboardingStep={0}
      setDraftPlayer={vi.fn()} setOnboardingStep={vi.fn()} onComplete={onComplete} onTryDemo={onTryDemo}
      accountConnection={connection} />));
    expect(container.textContent).toContain('Create account');
    expect(container.textContent).toContain('Already have an account? Sign in');
    expect(container.querySelector('[role="header"]')?.textContent).toBe('Find your next game');
    expect(container.textContent).not.toContain('ORBIT');
    expect(container.textContent).not.toContain('PLAYER');
    expect(container.textContent).not.toContain('Create an account to connect with venues, or explore a sample account.');
    expect(container.querySelector('input[aria-label="Name"]')).toBeNull();
    act(() => button('Try sample account')?.click());
    expect(onTryDemo).toHaveBeenCalledOnce();
    expect(connection.onConnect).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('exposes exact account-choice names to native accessibility independently of decorative icons', () => {
    act(() => root.render(<OnboardingScreen draftPlayer={validDraft} onboardingStep={0}
      setDraftPlayer={vi.fn()} setOnboardingStep={vi.fn()} onComplete={vi.fn()} onTryDemo={vi.fn()}
      accountConnection={accountConnection()} />));

    for (const label of ['Create account', 'Try sample account', 'Already have an account? Sign in']) {
      expect(button(label)?.getAttribute('aria-label')).toBe(label);
    }
  });

  it.each([
    { intent: 'create', busy: false, label: 'Create account / sign in' },
    { intent: 'signIn', busy: false, label: 'Sign in' },
    { intent: 'signIn', busy: true, label: 'Connecting...' }
  ])('exposes the exact $label credential action name without its lock icon', ({ intent, busy, label }) => {
    const connection = { ...accountConnection(), busy };
    act(() => root.render(<OnboardingScreen
      draftPlayer={{ ...validDraft, adultDeclaredAt: '2026-10-20T12:00:00Z', adultDeclarationVersion }}
      onboardingStep={3} setDraftPlayer={vi.fn()} setOnboardingStep={vi.fn()} onComplete={vi.fn()}
      accountConnection={connection} />));
    act(() => button(intent === 'create' ? 'Create account' : 'Already have an account? Sign in')?.click());
    if (intent === 'create') act(() => button('Continue to account')?.click());

    expect(button(label)?.getAttribute('aria-label')).toBe(label);
    expect(container.querySelector('[role="header"]')?.textContent).toBe(intent === 'create' ? 'Create account' : 'Sign in');
    expect(container.querySelector('input[aria-label="Account password or passphrase"]')?.getAttribute('placeholder')).toBe('At least 12 characters');
    expect(container.textContent).not.toContain('ORBIT');
    expect(container.textContent).not.toContain('Sign in to restore your saved Orbit profile.');
    if (intent === 'create') expect(container.textContent).toContain('Verify your email, then sign in to finish saving your profile.');
    expect(connection.onConnect).not.toHaveBeenCalled();
  });

  it('requires Firebase connection after the profile steps and keeps verification status visible without completing locally', () => {
    const onComplete = vi.fn();
    const connection = accountConnection();
    function Harness() {
      const [draftPlayer, setDraftPlayer] = useState<PlayerAccount>({ ...validDraft, adultDeclaredAt: '2026-10-20T12:00:00Z', adultDeclarationVersion });
      const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
      return <OnboardingScreen draftPlayer={draftPlayer} onboardingStep={step} setDraftPlayer={setDraftPlayer}
        setOnboardingStep={setStep} onComplete={onComplete} accountConnection={connection} />;
    }
    act(() => root.render(<Harness />));
    act(() => button('Create account')?.click());
    for (let step = 0; step < 3; step += 1) act(() => button('Continue')?.click());
    act(() => button('Continue to account')?.click());
    expect(connection.onChangeEmail).toHaveBeenCalledWith(validDraft.email);
    expect(container.querySelector('input[aria-label="Account password or passphrase"]')).not.toBeNull();
    expect(onComplete).not.toHaveBeenCalled();
    act(() => button('Create account / sign in')?.click());
    expect(connection.onConnect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alex', email: 'alex@example.test', adultDeclarationVersion }), false, 'create');
    expect(connection.onConnect).toHaveBeenCalledOnce();
    const submittedProfile = vi.mocked(connection.onConnect).mock.calls[0][0];
    expect(submittedProfile).not.toHaveProperty('password');
    expect(onComplete).not.toHaveBeenCalled();
    connection.status = 'Check your email to verify the account before signing in.';
    act(() => root.render(<Harness />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check your email to verify');
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('lets a returning player authenticate with an empty local profile after the adult declaration', () => {
    const connection = accountConnection();
    function Harness() {
      const [draftPlayer, setDraftPlayer] = useState({ ...validDraft, name: '', email: '' });
      return <OnboardingScreen draftPlayer={draftPlayer} onboardingStep={0} setDraftPlayer={setDraftPlayer}
        setOnboardingStep={vi.fn()} onComplete={vi.fn()} accountConnection={connection} />;
    }
    act(() => root.render(<Harness />));
    act(() => button('Already have an account? Sign in')?.click());
    expect(button('Sign in')?.disabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[role="checkbox"]')?.click());
    expect(button('Sign in')?.disabled).toBe(false);
    act(() => button('Sign in')?.click());
    expect(connection.onConnect).toHaveBeenCalledWith(expect.objectContaining({ name: '', email: 'alex@example.test', adultDeclarationVersion }), false, 'signIn');
    act(() => button('Forgot password')?.click());
    expect(connection.onRecover).toHaveBeenCalledOnce();
  });

  it('preserves optional Match setup until the account is connected and allows returning to the welcome choices', () => {
    const connection = accountConnection();
    const onCompleteWithMatchPreferences = vi.fn();
    function Harness() {
      const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
      return <OnboardingScreen draftPlayer={{ ...validDraft, adultDeclaredAt: '2026-10-20T12:00:00Z', adultDeclarationVersion }}
        onboardingStep={step} setDraftPlayer={vi.fn()} setOnboardingStep={setStep} onComplete={vi.fn()}
        onCompleteWithMatchPreferences={onCompleteWithMatchPreferences} accountConnection={connection} />;
    }
    act(() => root.render(<Harness />));
    act(() => button('Create account')?.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Previous step"]')?.click());
    expect(container.textContent).toContain('Already have an account? Sign in');
    act(() => button('Create account')?.click());
    for (let step = 0; step < 3; step += 1) act(() => button('Continue')?.click());
    act(() => button('Set Match preferences')?.click());
    expect(onCompleteWithMatchPreferences).not.toHaveBeenCalled();
    act(() => button('Create account / sign in')?.click());
    expect(connection.onConnect).toHaveBeenCalledWith(expect.objectContaining({ name: 'Alex' }), true, 'create');
  });

  it('blocks duplicate authentication and edits while the account connection is pending', () => {
    const connection = accountConnection();
    connection.busy = true;
    act(() => root.render(<OnboardingScreen draftPlayer={{ ...validDraft, adultDeclaredAt: '2026-10-20T12:00:00Z', adultDeclarationVersion }}
      onboardingStep={0} setDraftPlayer={vi.fn()} setOnboardingStep={vi.fn()} onComplete={vi.fn()} accountConnection={connection} />));
    act(() => button('Already have an account? Sign in')?.click());
    expect(button('Connecting...')?.disabled).toBe(true);
    act(() => button('Connecting...')?.click());
    expect(connection.onConnect).not.toHaveBeenCalled();
  });

  function button(text: string) {
    return Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent === text);
  }

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
    expect(completion?.getAttribute('aria-label')).toBe('Start exploring');
    expect(completion?.getAttribute('aria-disabled')).toBe('true');
    expect(container.querySelector('button[aria-label="Previous step"]')?.getAttribute('role')).toBe('button');
    expect(declaration?.getAttribute('aria-label')).toBe('I confirm that I am 18 or older');
    expect(declaration?.getAttribute('aria-checked')).toBe('false');

    act(() => completion?.click());
    expect(onComplete).not.toHaveBeenCalled();

    act(() => declaration?.click());
    expect(declaration?.getAttribute('aria-checked')).toBe('true');
    expect(completion?.disabled).toBe(false);
    expect(completion?.getAttribute('aria-disabled')).toBe('false');

    act(() => completion?.click());
    expect(onComplete).toHaveBeenCalledOnce();
  });
  it('offers Match setup only at the final step and uses the same adult gate while keeping normal completion independent', () => {
    const onComplete = vi.fn();
    const onCompleteWithMatchPreferences = vi.fn();
    function Harness({ step }: { step: 0 | 3 }) {
      const [draftPlayer, setDraftPlayer] = useState(validDraft);
      return <OnboardingScreen draftPlayer={draftPlayer} onboardingStep={step} setDraftPlayer={setDraftPlayer}
        setOnboardingStep={vi.fn()} onComplete={onComplete} onCompleteWithMatchPreferences={onCompleteWithMatchPreferences} />;
    }
    act(() => root.render(<Harness step={0} />));
    expect(container.querySelector('[aria-label="Set Match preferences"]')).toBeNull();
    act(() => root.render(<Harness step={3} />));
    const preferences = container.querySelector<HTMLButtonElement>('[aria-label="Set Match preferences"]');
    const declaration = container.querySelector<HTMLButtonElement>('[role="checkbox"]');
    expect(preferences?.disabled).toBe(true);
    act(() => preferences?.click());
    expect(onCompleteWithMatchPreferences).not.toHaveBeenCalled();
    act(() => declaration?.click());
    expect(preferences?.disabled).toBe(false);
    act(() => preferences?.click());
    expect(onCompleteWithMatchPreferences).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Start exploring"]')?.click());
    expect(onComplete).toHaveBeenCalledOnce();
    expect(onCompleteWithMatchPreferences).toHaveBeenCalledOnce();
  });
  it.each([
    { name: '', email: 'alex@example.test', phone: '' },
    { name: 'Alex', email: 'invalid', phone: '' },
    { name: 'Alex', email: 'alex@example.test', phone: 'invalid' }
  ])('never completes an invalid profile through the optional Match path: %o', (invalid) => {
    const onComplete = vi.fn(); const onCompleteWithMatchPreferences = vi.fn();
    act(() => root.render(<OnboardingScreen draftPlayer={{ ...validDraft, ...invalid, adultDeclarationVersion, adultDeclaredAt: '2026-10-12T12:00:00Z' }}
      onboardingStep={3} setDraftPlayer={vi.fn()} setOnboardingStep={vi.fn()}
      onComplete={onComplete} onCompleteWithMatchPreferences={onCompleteWithMatchPreferences} />));
    const preferences = container.querySelector<HTMLButtonElement>('[aria-label="Set Match preferences"]');
    expect(preferences?.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Start exploring"]')?.disabled).toBe(true);
    act(() => preferences?.click());
    expect(onCompleteWithMatchPreferences).not.toHaveBeenCalled(); expect(onComplete).not.toHaveBeenCalled();
  });
});

function accountConnection(): OnboardingAccountConnection {
  return {
    connected: false, email: 'alex@example.test', password: 'a-secure-passphrase', status: '', busy: false,
    onChangeEmail: vi.fn(), onChangePassword: vi.fn(), onConnect: vi.fn(), onRecover: vi.fn()
  };
}
