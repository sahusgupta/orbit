import { useCallback, useState } from 'react';
import { nowIso } from '../../../domain/state';
import { managementStorageKey } from '../../../domain/licensing';
import type { AppState } from '../../../domain/types';
import type { BrowserStorage } from '../../../app/persistence/browserStateRepository';

export type StaffRequestNotice = {
  id: string;
  kind: 'membership' | 'seat';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
};

export const staffNotificationsStorageKey = `${managementStorageKey}:staff-notifications`;

export const loadStaffRequestNotifications = (
  storage: Pick<BrowserStorage, 'getItem'> = localStorage
): StaffRequestNotice[] => {
  try {
    return JSON.parse(storage.getItem(staffNotificationsStorageKey) || '[]');
  } catch {
    return [];
  }
};

export const saveStaffRequestNotifications = (
  notifications: StaffRequestNotice[],
  storage: Pick<BrowserStorage, 'setItem'> = localStorage
) => {
  storage.setItem(staffNotificationsStorageKey, JSON.stringify(notifications));
};

export const getIncomingStaffRequestNotice = (
  previousState: AppState,
  nextState: AppState,
  clock: { nowIso: () => string; nowMs: () => number } = { nowIso, nowMs: Date.now }
): StaffRequestNotice | null => {
  const membershipRequest = nextState.profiles
    .filter((profile) => profile.membershipStatus === 'Requested')
    .filter((profile) => !previousState.profiles.some((candidate) =>
      candidate.id === profile.id &&
      candidate.membershipStatus === 'Requested' &&
      candidate.membershipRequestedAt === profile.membershipRequestedAt
    ))
    .sort((left, right) => Date.parse(right.membershipRequestedAt || '') - Date.parse(left.membershipRequestedAt || ''))[0];
  if (membershipRequest) {
    return {
      id: `membership-${membershipRequest.id}-${membershipRequest.membershipRequestedAt || clock.nowMs()}`,
      kind: 'membership',
      title: 'New membership request',
      body: `${membershipRequest.name} applied from the player app.`,
      createdAt: clock.nowIso(),
      read: false
    };
  }

  const seatRequest = nextState.interests
    .filter((interest) => !previousState.interests.some((candidate) => candidate.id === interest.id))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  if (!seatRequest) return null;
  const gameName = nextState.games.find((game) => game.id === seatRequest.gameId)?.name ?? 'a game';
  return {
    id: `seat-${seatRequest.id}`,
    kind: 'seat',
    title: 'New seat request',
    body: `${seatRequest.playerName} requested a seat in ${gameName}.`,
    createdAt: clock.nowIso(),
    read: false
  };
};

export const prependStaffRequestNotification = (
  current: StaffRequestNotice[],
  notification: StaffRequestNotice
) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 100);

export const useStaffRequestNotifications = () => {
  const [staffRequestNotice, setStaffRequestNotice] = useState<StaffRequestNotice | null>(null);
  const [staffNotifications, setStaffNotifications] = useState<StaffRequestNotice[]>(loadStaffRequestNotifications);

  const announceIncomingPlayerRequest = useCallback((previousState: AppState, nextState: AppState) => {
    const notification = getIncomingStaffRequestNotice(previousState, nextState);
    if (!notification) return;
    setStaffRequestNotice(notification);
    setStaffNotifications((current) => {
      const next = prependStaffRequestNotification(current, notification);
      saveStaffRequestNotifications(next);
      return next;
    });
  }, []);

  const markStaffNotificationRead = useCallback((notification: StaffRequestNotice) => {
    setStaffNotifications((current) => {
      const next = current.map((item) => item.id === notification.id ? { ...item, read: true } : item);
      saveStaffRequestNotifications(next);
      return next;
    });
    setStaffRequestNotice((current) => current?.id === notification.id ? null : current);
  }, []);

  const replaceStaffNotifications = useCallback((notifications: StaffRequestNotice[]) => {
    setStaffNotifications(notifications);
    saveStaffRequestNotifications(notifications);
  }, []);

  return {
    announceIncomingPlayerRequest,
    markStaffNotificationRead,
    replaceStaffNotifications,
    setStaffRequestNotice,
    staffNotifications,
    staffRequestNotice
  };
};
