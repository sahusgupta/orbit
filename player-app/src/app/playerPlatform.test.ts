import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  alert: vi.fn(),
  openURL: vi.fn(),
  currentAppState: vi.fn<() => string | null | undefined>()
}));

vi.mock('react-native', () => ({
  Alert: { alert: native.alert },
  AppState: { get currentState() { return native.currentAppState(); }, addEventListener: vi.fn() },
  Linking: { openSettings: vi.fn(), openURL: native.openURL },
  Platform: { OS: 'ios', Version: '26.0', select: (values: Record<string, string>) => values.ios }
}));

import { playerPlatform } from './playerPlatform';

describe('Player platform app-state boundary', () => {
  it.each(['active', 'background', 'inactive', 'unknown', 'extension'] as const)('preserves the supported %s state', (state) => {
    native.currentAppState.mockReturnValue(state);
    expect(playerPlatform.getCurrentAppState()).toBe(state);
  });

  it('preserves an uninitialized null state', () => {
    native.currentAppState.mockReturnValue(null);
    expect(playerPlatform.getCurrentAppState()).toBeNull();
  });

  it('normalizes an unset native state to the uninitialized fallback', () => {
    native.currentAppState.mockReturnValue(undefined);
    expect(playerPlatform.getCurrentAppState()).toBeNull();
  });

  it('keeps an unfamiliar native state outside the active polling state', () => {
    native.currentAppState.mockReturnValue('future-native-state');
    expect(playerPlatform.getCurrentAppState()).toBe('unknown');
  });
});

describe('Player platform deletion confirmations', () => {
  beforeEach(() => { native.alert.mockReset(); native.openURL.mockReset().mockResolvedValue(undefined); });

  it('hands the published destination to Apple Maps and exposes an OS handoff failure', async () => {
    expect(await playerPlatform.openDirections('100 Main St', { latitude: 30.3, longitude: -97.7 })).toEqual({ ok: true });
    expect(native.openURL).toHaveBeenCalledWith('https://maps.apple.com/directions?destination=30.3%2C-97.7&mode=driving');
    native.openURL.mockRejectedValueOnce(new Error('OS rejected the URL'));
    const result = await playerPlatform.openDirections('100 Main St');
    expect(result.ok).toBe(false);
    expect(native.alert).toHaveBeenCalledWith('Directions unavailable', expect.stringContaining('Try again'));
  });

  it('does not launch maps with an invented destination when publication is missing', async () => {
    expect((await playerPlatform.openDirections('')).ok).toBe(false);
    expect(native.openURL).not.toHaveBeenCalled();
    expect(native.alert).toHaveBeenCalledWith('Directions unavailable', expect.stringContaining('valid address or coordinate'));
  });

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
    expect(native.alert.mock.calls[0]?.[1]).toMatch(/local profile (?:was|were) deleted/);
  });

  it('does not claim server profile data was deleted while the durable job is pending', () => {
    playerPlatform.showAccountDeletionResult({
      currentAccountPreserved: false,
      localDataCleared: true,
      retainedCategories: [],
      signedOut: true,
      status: 'pending'
    });
    expect(native.alert.mock.calls[0]?.[1]).toContain('Server account-data cleanup and sign-in deletion are still in progress');
    expect(native.alert.mock.calls[0]?.[1]).not.toContain('Your Orbit profile data and local profile were deleted');
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
