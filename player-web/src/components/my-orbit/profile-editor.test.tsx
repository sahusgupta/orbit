import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerAccount } from '@/src/domain/types';

const state = vi.hoisted(() => ({
  player: {
    id: 'player-1',
    name: 'Avery Stone',
    email: 'avery@example.com',
    preferredGameIds: [],
    favoriteClubIds: []
  } as PlayerAccount,
  updatePlayer: vi.fn(async () => undefined),
  signOutPlayer: vi.fn(async () => undefined),
  deletePlayerAccount: vi.fn(async () => ({
    initiatingUid: 'player-1',
    status: 'pending' as const,
    retainedCategories: ['legal transaction record'],
    currentAccountPreserved: false,
    signedOut: true
  })),
  fetchIdentityStatus: vi.fn(async () => ({ ageVerified: false }))
}));

vi.mock('@/src/auth/auth-context', () => ({
  useAuth: () => ({
    user: { uid: 'player-1', email: 'avery@example.com' },
    player: state.player,
    updatePlayer: state.updatePlayer,
    signOutPlayer: state.signOutPlayer,
    deletePlayerAccount: state.deletePlayerAccount
  })
}));

vi.mock('@/src/data/player-api', () => ({
  createIdentitySession: vi.fn(),
  fetchIdentityStatus: state.fetchIdentityStatus
}));

import { ProfileEditor } from './profile-editor';

afterEach(cleanup);

beforeEach(() => {
  state.updatePlayer.mockClear();
  state.signOutPlayer.mockClear();
  state.deletePlayerAccount.mockClear();
  state.fetchIdentityStatus.mockClear();
});

describe('Player Web profile editor', () => {
  it('keeps unrequested preferences blank and records adult eligibility only after the user confirms it', async () => {
    render(<ProfileEditor />);
    const adultDeclaration = screen.getByRole('checkbox', { name: /18 years of age or older/i });
    expect(screen.getByLabelText('Search radius (miles)')).toHaveValue(null);
    expect(adultDeclaration).not.toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(state.updatePlayer).not.toHaveBeenCalled();

    await userEvent.click(adultDeclaration);
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(state.updatePlayer).toHaveBeenCalledOnce());
    expect(state.updatePlayer).toHaveBeenCalledWith(expect.objectContaining({
      adultDeclarationVersion: 'v1',
      adultDeclaredAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    }));
  });

  it('requires confirmation and reports accepted pending deletion without claiming completion', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(<ProfileEditor />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    await waitFor(() => expect(state.deletePlayerAccount).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('permanently deletes'));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('server cleanup is still being finalized'));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('This browser is signed out'));
    expect(alert).not.toHaveBeenCalledWith(expect.stringMatching(/^Your Orbit account was deleted/));
  });

  it('leaves deletion unsent when confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ProfileEditor />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));

    expect(state.deletePlayerAccount).not.toHaveBeenCalled();
  });
});
