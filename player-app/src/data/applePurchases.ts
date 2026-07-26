import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage
} from 'react-native-purchases';

export const playerPremiumEntitlementId =
  process.env.EXPO_PUBLIC_REVENUECAT_PREMIUM_ENTITLEMENT_ID || 'player_premium';

const appleApiKey = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY || '';
let configuredUserId = '';

export type PlayerPremiumOffering = {
  package: PurchasesPackage;
  priceLabel: string;
};

function hasPremiumEntitlement(customerInfo: CustomerInfo) {
  return Boolean(customerInfo.entitlements.active[playerPremiumEntitlementId]);
}

export async function configureApplePurchases(appUserId: string) {
  if (Platform.OS !== 'ios') return { configured: false, active: false };
  if (!appleApiKey) return { configured: false, active: false };

  if (!configuredUserId) {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    Purchases.configure({ apiKey: appleApiKey, appUserID: appUserId });
    configuredUserId = appUserId;
  } else if (configuredUserId !== appUserId) {
    await Purchases.logIn(appUserId);
    configuredUserId = appUserId;
  }

  const customerInfo = await Purchases.getCustomerInfo();
  return { configured: true, active: hasPremiumEntitlement(customerInfo) };
}

export async function getPlayerPremiumOffering(): Promise<PlayerPremiumOffering | null> {
  const offerings = await Purchases.getOfferings();
  const offering = offerings.current;
  const premiumPackage =
    offering?.monthly ??
    offering?.availablePackages.find((item) =>
      item.product.identifier === process.env.EXPO_PUBLIC_APPLE_PREMIUM_PRODUCT_ID
    ) ??
    offering?.availablePackages[0];

  return premiumPackage
    ? { package: premiumPackage, priceLabel: premiumPackage.product.priceString }
    : null;
}

export async function purchasePlayerPremium(offering: PlayerPremiumOffering) {
  const { customerInfo } = await Purchases.purchasePackage(offering.package);
  return hasPremiumEntitlement(customerInfo);
}

export async function restorePlayerPremium() {
  const customerInfo = await Purchases.restorePurchases();
  return hasPremiumEntitlement(customerInfo);
}

export function subscribeToPremiumChanges(listener: (active: boolean) => void) {
  const customerInfoListener = (customerInfo: CustomerInfo) =>
    listener(hasPremiumEntitlement(customerInfo));
  Purchases.addCustomerInfoUpdateListener(customerInfoListener);
  return () => Purchases.removeCustomerInfoUpdateListener(customerInfoListener);
}
