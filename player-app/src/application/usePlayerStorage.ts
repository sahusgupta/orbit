import { useEffect, useState } from 'react';
import { hasAdultDeclaration } from '../domain/playerOnboarding';
import { normalizeE164Phone } from '../domain/playerPhone';
import type { PlayerAccount } from '../domain/playerSync';
import { playerStorage } from '../data/storage/playerStorage';

export function usePlayerStorage(emptyPlayer: PlayerAccount) {
  const [hasAccount, setHasAccount] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState<0 | 1 | 2 | 3>(0);
  const [player, setPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [draftPlayer, setDraftPlayer] = useState<PlayerAccount>(emptyPlayer);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const [dismissedAlertsLoaded, setDismissedAlertsLoaded] = useState(false);
  const [playerStorageError, setPlayerStorageError] = useState('');
  const [storageLoadFailed, setStorageLoadFailed] = useState(false);
  const [storageLoadRetryVersion, setStorageLoadRetryVersion] = useState(0);
  const [storageSaveRetryVersion, setStorageSaveRetryVersion] = useState(0);

  useEffect(() => {
    let active = true;
    setAccountLoaded(false);
    // A storage read failure is distinct from a missing profile so onboarding
    // cannot overwrite data that may still exist on the device.
    playerStorage.loadPlayer(emptyPlayer)
      .then((result) => {
        if (!active) return;
        setStorageLoadFailed(false);
        setPlayerStorageError('');
        if (result.kind === 'restored') {
          setPlayer(result.player);
          setDraftPlayer(result.player);
          setHasAccount(hasAdultDeclaration(result.player));
          setOnboardingStep(3);
        }
      })
      .catch(() => {
        if (active) {
          setStorageLoadFailed(true);
          setPlayerStorageError('Orbit could not restore profile data saved on this device. Retry before editing your profile.');
        }
      })
      .finally(() => active && setAccountLoaded(true));
    return () => {
      active = false;
    };
  }, [storageLoadRetryVersion]);

  useEffect(() => {
    const phoneInput = player.phone?.trim() ?? '';
    const normalizedPhone = normalizeE164Phone(phoneInput);
    const hasPersistableContact = Boolean(player.email.trim()) || Boolean(normalizedPhone);
    if (phoneInput && !normalizedPhone) return;
    if (!accountLoaded || !hasAccount || !player.name.trim() || !hasPersistableContact) return;
    let active = true;
    const persistedPlayer = normalizedPhone && normalizedPhone !== player.phone ? { ...player, phone: normalizedPhone } : player;
    playerStorage.savePlayer(persistedPlayer)
      .then(() => {
        if (active) setPlayerStorageError('');
      })
      .catch((error) => {
        if (!active) return;
        const detail = error instanceof Error ? ` ${error.message}` : '';
        setPlayerStorageError(`Profile changes could not be saved securely on this device.${detail}`);
      });
    return () => {
      active = false;
    };
  }, [accountLoaded, hasAccount, player, storageSaveRetryVersion]);

  useEffect(() => {
    if (!accountLoaded || !hasAccount) return;
    playerStorage.loadDismissedAlertIds()
      .then(setDismissedNotificationIds)
      .catch(() => setDismissedNotificationIds([]))
      .finally(() => setDismissedAlertsLoaded(true));
  }, [accountLoaded, hasAccount]);

  const dismissInAppAlert = (notificationId: string) => {
    setDismissedNotificationIds((current) => {
      const next = Array.from(new Set([...current, notificationId]));
      // Dismissal remains effective for this session if device persistence fails.
      playerStorage.saveDismissedAlertIds(next).catch(() => undefined);
      return next;
    });
  };

  const clearLocalPlayer = async () => {
    try {
      await playerStorage.clearPlayer();
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setPlayerStorageError(`Orbit could not clear this device's local profile data.${detail}`);
      throw error;
    }
    setPlayer(emptyPlayer);
    setDraftPlayer(emptyPlayer);
    setHasAccount(false);
    setOnboardingStep(0);
    setDismissedNotificationIds([]);
    setDismissedAlertsLoaded(false);
    setStorageLoadFailed(false);
    setPlayerStorageError('');
  };

  return {
    accountLoaded,
    clearLocalPlayer,
    dismissedAlertsLoaded,
    dismissedNotificationIds,
    dismissInAppAlert,
    draftPlayer,
    hasAccount,
    onboardingStep,
    player,
    playerStorageError,
    retryPlayerStorage: () => {
      if (storageLoadFailed) {
        setStorageLoadRetryVersion((current) => current + 1);
      } else {
        setStorageSaveRetryVersion((current) => current + 1);
      }
    },
    setDraftPlayer,
    setHasAccount,
    setOnboardingStep,
    setPlayer
  };
}
