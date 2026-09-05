import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ alert: vi.fn() }));

vi.mock('react-native', () => ({
  Alert: { alert: native.alert },
  AppState: { currentState: 'active', addEventListener: vi.fn() },
  Linking: { openSettings: vi.fn(), openURL: vi.fn() },
  Platform: { OS: 'ios', select: (values: Record<string, string>) => values.ios }
}));

import { playerPlatform } from './playerPlatform';

describe('Player platform deletion confirmations', () => {
  beforeEach(() => native.alert.mockReset());

  it('distinguishes local profile/data deletion from authenticated account deletion', () => {
    const confirm = vi.fn();
    playerPlatform.confirmLocalProfileDeletion(confirm);
    expect(native.alert).toHaveBeenCalledWith(
      'Delete local profile and data?',
      expect.stringContaining('stored on this device'),
      expect.arrayContaining([expect.objectContaining({ text: 'Delete local data', onPress: confirm })])
    );
    expect(native.alert.mock.calls[0]?.[1]).toContain('does not delete a signed-in account');

    native.alert.mockClear();
    playerPlatform.confirmAccountDeletion(confirm);
    expect(native.alert).toHaveBeenCalledWith(
      'Delete Orbit Player account?',
      expect.stringContaining('profile and sign-in'),
      expect.arrayContaining([expect.objectContaining({ text: 'Delete account', onPress: confirm })])
    );
  });

  it('describes policy-retained categories without claiming they are de-identified', () => {
    playerPlatform.showAccountDeletionResult({
      currentAccountPreserved: false,
      localDataCleared: true,
      retainedCategories: ['payment-provider-records'],
      signedOut: true,
      status: 'complete'
    });
    expect(native.alert).toHaveBeenCalledWith(
      'Orbit account deleted',
      expect.stringContaining("may be retained under Orbit's privacy and legal policy")
    );
    expect(native.alert.mock.calls[0]?.[1]).not.toContain('without your direct identity');
  });

  it('treats a durable pending response as accepted and does not tell the user to retry', () => {
    playerPlatform.showAccountDeletionResult({
      currentAccountPreserved: false,
      localDataCleared: true,
      retainedCategories: [],
      signedOut: true,
      status: 'pending'
    });
    expect(native.alert).toHaveBeenCalledWith(
      'Account deletion accepted',
      expect.stringContaining('no server retry is required')
    );
    expect(native.alert.mock.calls[0]?.[1]).toContain('local profile were deleted');
  });

  it('requires explicit device cleanup when accepted deletion could not confirm sign-out', () => {
    playerPlatform.showAccountDeletionResult({
      currentAccountPreserved: false,
      localDataCleared: true,
      retainedCategories: [],
      signedOut: false,
      status: 'pending'
    });
    expect(native.alert.mock.calls[0]?.[1]).toContain('could not confirm secure sign-out');
    expect(native.alert.mock.calls[0]?.[1]).toContain('remain blocked until you retry');
  });

  it('states that a newly current account stayed signed in and its local identity was preserved', () => {
    playerPlatform.showAccountDeletionResult({
      currentAccountPreserved: true,
      localDataCleared: false,
      retainedCategories: [],
      signedOut: false,
      status: 'pending'
    });

    expect(native.alert).toHaveBeenCalledWith(
      'Prior account deletion accepted',
      expect.stringContaining('account now signed in on this device remained signed in')
    );
    expect(native.alert.mock.calls[0]?.[1]).toContain('local profile and identity were preserved');
    expect(native.alert.mock.calls[0]?.[1]).not.toContain('local profile were deleted');
  });
});
