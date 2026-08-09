import { useEffect, useState } from 'react';
import {
  configureApplePurchases,
  getPlayerPremiumOffering,
  purchasePlayerPremium,
  restorePlayerPremium,
  subscribeToPremiumChanges,
  type PlayerPremiumOffering
} from '../data/applePurchases';

export const defaultPremiumMonthlyPriceLabel = '$12.99/month';

type UsePlayerPremiumOptions = {
  accountLoaded: boolean;
  enabled: boolean;
  hasAccount: boolean;
  platformOS: string;
  playerId: string;
};

export function usePlayerPremium({ accountLoaded, enabled, hasAccount, platformOS, playerId }: UsePlayerPremiumOptions) {
  const [premiumStatus, setPremiumStatus] = useState<'inactive' | 'pending' | 'active'>('inactive');
  const [premiumMessage, setPremiumMessage] = useState('');
  const [premiumOffering, setPremiumOffering] = useState<PlayerPremiumOffering | null>(null);
  const [premiumMonthlyPriceLabel, setPremiumMonthlyPriceLabel] = useState(defaultPremiumMonthlyPriceLabel);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!accountLoaded || !hasAccount || !playerId) return;
    let active = true;
    let unsubscribe: () => void = () => undefined;

    configureApplePurchases(playerId)
      .then(async (status) => {
        if (!active) return;
        if (!status.configured) {
          setPremiumStatus('inactive');
          setPremiumMessage(platformOS === 'ios' ? 'Apple purchases are not configured for this build.' : '');
          return;
        }
        setPremiumStatus(status.active ? 'active' : 'inactive');
        const offering = await getPlayerPremiumOffering();
        if (!active) return;
        setPremiumOffering(offering);
        if (offering) setPremiumMonthlyPriceLabel(offering.priceLabel);
        unsubscribe = subscribeToPremiumChanges((isActive) => {
          setPremiumStatus(isActive ? 'active' : 'inactive');
        });
      })
      .catch((error) => {
        if (active) setPremiumMessage(error instanceof Error ? error.message : 'Unable to connect to Apple purchases.');
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [accountLoaded, enabled, hasAccount, platformOS, playerId]);

  const openPremiumCheckout = async () => {
    if (platformOS !== 'ios') {
      setPremiumMessage('Player Premium purchases are currently available in the iOS app.');
      return;
    }
    if (!premiumOffering) {
      setPremiumMessage('Player Premium is not available from the App Store right now. Please try again later.');
      return;
    }
    setPremiumMessage('Opening Apple purchase sheet...');
    setPremiumStatus('pending');
    try {
      const active = await purchasePlayerPremium(premiumOffering);
      setPremiumStatus(active ? 'active' : 'inactive');
      setPremiumMessage(active ? 'Player Premium is active.' : 'Apple did not confirm an active subscription.');
    } catch (error) {
      setPremiumStatus('inactive');
      const cancelled = (error as { userCancelled?: boolean }).userCancelled;
      setPremiumMessage(cancelled ? 'Purchase cancelled.' : error instanceof Error ? error.message : 'Unable to complete the purchase.');
    }
  };

  const restorePremiumPurchases = async () => {
    setPremiumMessage('Restoring Apple purchases...');
    try {
      const active = await restorePlayerPremium();
      setPremiumStatus(active ? 'active' : 'inactive');
      setPremiumMessage(active ? 'Player Premium restored.' : 'No active Player Premium subscription was found.');
    } catch (error) {
      setPremiumMessage(error instanceof Error ? error.message : 'Unable to restore purchases.');
    }
  };

  return {
    hasPlayerPremium: premiumStatus === 'active',
    openPremiumCheckout,
    premiumMessage,
    premiumMonthlyPriceLabel,
    premiumStatus,
    restorePremiumPurchases,
    setPremiumMessage,
    setPremiumStatus
  };
}
