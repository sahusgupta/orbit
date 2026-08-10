import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let active = true;
    // A storage read failure follows the same cold-start path as missing local data.
    playerStorage.loadPlayer(emptyPlayer)
      .then((result) => {
        if (!active || result.kind !== 'restored') return;
        setPlayer(result.player);
        setDraftPlayer(result.player);
        setHasAccount(true);
        setOnboardingStep(3);
      })
      .catch(() => undefined)
      .finally(() => active && setAccountLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!accountLoaded || !hasAccount || !player.name.trim() || !player.email.trim()) return;
    // The in-memory account remains usable if background device persistence fails.
    playerStorage.savePlayer(player).catch(() => undefined);
  }, [accountLoaded, hasAccount, player]);

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
    await playerStorage.clearPlayer();
    setPlayer(emptyPlayer);
    setDraftPlayer(emptyPlayer);
    setHasAccount(false);
    setOnboardingStep(0);
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
    setDraftPlayer,
    setHasAccount,
    setOnboardingStep,
    setPlayer
  };
}
