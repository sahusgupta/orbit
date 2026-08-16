import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/auth', () => ({
  onIdTokenChanged: vi.fn(() => vi.fn())
}));

vi.mock('@/src/data/firebase-client', () => ({
  getFirebaseBrowserClient: vi.fn(async () => ({ auth: {} })),
  isFirebaseBrowserSyncEnabled: vi.fn(() => true)
}));

vi.mock('@/src/data/player-profile', () => ({
  fetchWebPlayerProfile: vi.fn(),
  saveWebPlayerProfile: vi.fn()
}));

import { AuthProvider, useAuth } from './auth-context';
import { persistPlayerSessionToken, PLAYER_SESSION_COOKIE } from './session-cookie';

function AuthStateProbe() {
  const { error, status } = useAuth();
  return <div><span>{status}</span>{error ? <p role="alert">{error}</p> : null}</div>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Player Web authentication startup', () => {
  it('falls back to signed out when Firebase never emits its initial auth state', async () => {
    vi.useFakeTimers();
    persistPlayerSessionToken('stale-token');
    render(<AuthProvider><AuthStateProbe /></AuthProvider>);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('loading')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001);
    });

    expect(screen.getByText('signed-out')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(/took too long/i);
    expect(document.cookie).not.toContain(`${PLAYER_SESSION_COOKIE}=`);
  });
});
