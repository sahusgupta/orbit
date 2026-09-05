import type { PlayerClubSnapshot, PlayerSyncGame } from './playerSync';

export type ClubFeeProfile = {
  type: 'time' | 'drop' | 'unknown';
  label: string;
};

export function getClubFeeProfile(club: PlayerClubSnapshot, game?: PlayerSyncGame): ClubFeeProfile {
  const liveMode = game?.collectionMode ?? game?.openTables[0]?.collectionMode;
  if (liveMode === 'Time') {
    const publishedCents = club.timeAccess?.enabled && Number.isFinite(club.timeAccess.hourlyFeeCents)
      ? Math.max(0, club.timeAccess.hourlyFeeCents)
      : null;
    return {
      type: 'time',
      label: publishedCents == null ? 'Time rate not published' : `$${(publishedCents / 100).toFixed(2)}/hr`
    };
  }
  if (liveMode === 'Drop') return { type: 'drop', label: 'Drop amount not published' };
  return { type: 'unknown', label: 'Collection details not published' };
}

export function getAccessProfileText(club: PlayerClubSnapshot, game?: PlayerSyncGame) {
  const fee = getClubFeeProfile(club, game);
  const mode = fee.type === 'time' ? 'Time collection' : fee.type === 'drop' ? 'Drop collection' : 'Collection';
  return `${mode}: ${fee.label}. Confirm current fees and membership terms with the venue.`;
}
