import type { PlayerClubSnapshot } from './playerSync';

export function getLatestInAppNotification(clubs: PlayerClubSnapshot[], dismissedIds: string[]) {
  const dismissed = new Set(dismissedIds);
  const now = Date.now();
  return clubs
    .flatMap((club) => club.notifications ?? [])
    .filter((notification) => !dismissed.has(notification.id))
    .filter((notification) => !notification.expiresAt || Date.parse(notification.expiresAt) > now)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}
