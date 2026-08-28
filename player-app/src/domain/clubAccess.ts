import type { PlayerClubSnapshot, PlayerSyncGame } from './playerSync';
import type { ClubAccessProduct, TimeAccessProduct } from './playerTypes';

export const timeAccessOptions: ReadonlyArray<{ product: TimeAccessProduct; minutes: number; label: string }> = [
  { product: 'time-30', minutes: 30, label: '30 min' },
  { product: 'time-60', minutes: 60, label: '1 hour' },
  { product: 'time-120', minutes: 120, label: '2 hours' }
];

export function isTimeAccessProduct(product: ClubAccessProduct): product is TimeAccessProduct {
  return product.startsWith('time-');
}

const clubFeeProfiles: Record<string, { type: 'time'; hourly: string } | { type: 'rake'; percent: string }> = {};

export function getClubProductName(product: ClubAccessProduct) {
  if (product === 'day') return 'Day Pass';
  if (product === 'monthly') return 'Monthly Membership';
  return timeAccessOptions.find((option) => option.product === product)?.label ?? 'Time Pack';
}

export function formatDropFee(value: string) {
  return value.toLowerCase().includes('drop') ? value : `${value} drop`;
}

export type ClubMembershipPrices = {
  day: string;
  monthly: string;
  time30: string;
  time60: string;
  time120: string;
};

export function getClubProductLabel(product: ClubAccessProduct, prices: ClubMembershipPrices) {
  if (product === 'day') return prices.day;
  if (product === 'monthly') return prices.monthly;
  if (product === 'time-30') return prices.time30;
  if (product === 'time-60') return prices.time60;
  return prices.time120;
}

export function getClubMembershipPrices(club: PlayerClubSnapshot) {
  const formatTimePrice = (minutes: number) => club.timeAccess?.hourlyFeeCents
    ? `$${((club.timeAccess.hourlyFeeCents * minutes) / 6000).toFixed(2)}`
    : 'Club-priced time';
  return {
    day: 'Club-priced day pass',
    monthly: 'Club-priced membership',
    time30: formatTimePrice(30),
    time60: formatTimePrice(60),
    time120: formatTimePrice(120)
  };
}

export function getClubFeeProfile(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const configured = clubFeeProfiles[club.club.id] ?? { type: 'time' as const, hourly: '$10/hr' };
  const liveMode = game?.collectionMode ?? game?.openTables[0]?.collectionMode;
  if (liveMode === 'Time') {
    return configured.type === 'time' ? configured : { type: 'time' as const, hourly: '$10/hr' };
  }
  if (liveMode === 'Drop') {
    return { type: 'rake' as const, percent: 'House drop' };
  }
  return configured;
}

export function getAccessProfileText(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const membership = getClubMembershipPrices(club);
  const fees = getClubFeeProfile(club, game);
  if (fees.type === 'time') return `Paid time: ${fees.hourly} / Membership fee: ${membership.day} or ${membership.monthly}`;
  if (game?.collectionMode === 'Drop' || game?.openTables[0]?.collectionMode === 'Drop') {
    return `Drop collection: configured by club / Membership fee: ${membership.day} or ${membership.monthly}`;
  }
  return `Rake taken: ${fees.percent} of pot / Membership fee: ${membership.day} or ${membership.monthly}`;
}
