import type { PlayerClubSnapshot, PlayerSyncGame } from './playerSync';
import type { ClubAccessProduct } from './playerTypes';

const clubFeeProfiles: Record<string, { type: 'time'; hourly: string } | { type: 'rake'; percent: string }> = {};

export function getClubProductName(product: ClubAccessProduct) {
  if (product === 'day') return 'Day Pass';
  if (product === 'monthly') return 'Monthly Membership';
  return '5-Hour Time Pack';
}

export function formatDropFee(value: string) {
  return value.toLowerCase().includes('drop') ? value : `${value} drop`;
}

export function getClubProductLabel(product: ClubAccessProduct, prices: { day: string; monthly: string; timePack: string }) {
  if (product === 'day') return prices.day;
  if (product === 'monthly') return prices.monthly;
  return prices.timePack;
}

export function getClubMembershipPrices(club: PlayerClubSnapshot) {
  void club;
  return { day: 'Club-priced day pass', monthly: 'Club-priced membership', timePack: 'Club-priced time package' };
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
