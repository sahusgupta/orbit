import { useCallback, useState } from 'react';
import { nowIso } from '../../../domain/state';
import { managementStorageKey } from '../../../domain/licensing';
import type { AppState, StaffAssistanceRequest } from '../../../domain/types';
import type { BrowserStorage } from '../../../app/persistence/browserStateRepository';

export type StaffRequestNotice = {
  id: string;
  kind: 'membership' | 'seat' | 'walk-in';
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  staffRequestId?: string;
  playerName?: string;
};

export const staffNotificationsStorageKey = `${managementStorageKey}:staff-notifications`;

export const loadStaffRequestNotifications = (
  storage: Pick<BrowserStorage, 'getItem'> = localStorage
): StaffRequestNotice[] => {
  try {
    const persisted = JSON.parse(storage.getItem(staffNotificationsStorageKey) || '[]');
    if (!Array.isArray(persisted)) return [];
    return persisted
      .filter((item) =>
        item &&
        typeof item.id === 'string' &&
        ['membership', 'seat', 'walk-in'].includes(item.kind) &&
        typeof item.createdAt === 'string'
      )
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.kind === 'membership'
          ? 'Membership request'
          : item.kind === 'walk-in'
            ? 'Walk-in needs assistance'
            : 'Seat request',
        body: 'Open Orbit to review this request.',
        createdAt: item.createdAt,
        read: Boolean(item.read),
        staffRequestId: typeof item.staffRequestId === 'string' ? item.staffRequestId : undefined
      }));
  } catch {
    return [];
  }
};

export const saveStaffRequestNotifications = (
  notifications: StaffRequestNotice[],
  storage: Pick<BrowserStorage, 'setItem'> = localStorage
) => {
  storage.setItem(staffNotificationsStorageKey, JSON.stringify(notifications.map((notification) => ({
    id: notification.id,
    kind: notification.kind,
    createdAt: notification.createdAt,
    read: notification.read,
    staffRequestId: notification.staffRequestId
  }))));
};

const noticeForWalkInRequest = (request: StaffAssistanceRequest): StaffRequestNotice => ({
  id: `walk-in-${request.id}`,
  kind: 'walk-in',
  title: 'Walk-in needs assistance',
  body: `${request.playerName} scanned the club code and needs staff assistance.`,
  createdAt: request.createdAt,
  read: false,
  staffRequestId: request.id,
  playerName: request.playerName
});

export const getIncomingStaffRequestNotices = (
  previousState: AppState,
  nextState: AppState,
  clock: { nowIso: () => string; nowMs: () => number } = { nowIso, nowMs: Date.now }
): StaffRequestNotice[] => {
  const membershipRequests = nextState.profiles
    .filter((profile) =>
      profile.membershipStatus === 'Requested' ||
      (profile.membershipStatus === 'Approved' &&
        (profile.identityReviewStatus === 'Pending' || profile.membershipPaymentStatus === 'Pending'))
    )
    .filter((profile) => !previousState.profiles.some((candidate) =>
      candidate.id === profile.id &&
      candidate.membershipStatus === profile.membershipStatus &&
      candidate.identityReviewStatus === profile.identityReviewStatus &&
      candidate.membershipPaymentStatus === profile.membershipPaymentStatus &&
      candidate.membershipRequestedAt === profile.membershipRequestedAt
    ))
    .sort((left, right) => Date.parse(right.membershipRequestedAt || '') - Date.parse(left.membershipRequestedAt || ''))
    .map((profile) => ({
      id: `membership-${profile.id}-${profile.membershipRequestedAt || clock.nowMs()}`,
      kind: 'membership' as const,
      title: 'New membership request',
      body: `${profile.name} signed up from the player app.${profile.identityReviewStatus === 'Pending' ? ' ID review required.' : ''}${profile.membershipPaymentStatus === 'Pending' ? profile.membershipPaymentMethod === 'app' ? ' Awaiting online payment.' : ' Payment due in person.' : ''}`,
      createdAt: clock.nowIso(),
      read: false
    }));

  const walkInRequests = nextState.staffRequests
    .filter((request) => request.status === 'pending')
    .filter((request) => !previousState.staffRequests.some((candidate) => candidate.id === request.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .map(noticeForWalkInRequest);

  const seatRequests = nextState.interests
    .filter((interest) => !previousState.interests.some((candidate) => candidate.id === interest.id))
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .map((interest) => {
      const gameName = nextState.games.find((game) => game.id === interest.gameId)?.name ?? 'a game';
      return {
        id: `seat-${interest.id}`,
        kind: 'seat' as const,
        title: 'New seat request',
        body: `${interest.playerName} requested a seat in ${gameName}.`,
        createdAt: clock.nowIso(),
        read: false
      };
    });

  return [...membershipRequests, ...walkInRequests, ...seatRequests];
};

export const getIncomingStaffRequestNotice = (
  previousState: AppState,
  nextState: AppState,
  clock: { nowIso: () => string; nowMs: () => number } = { nowIso, nowMs: Date.now }
): StaffRequestNotice | null => {
  return getIncomingStaffRequestNotices(previousState, nextState, clock)[0] ?? null;
};

export const prependStaffRequestNotification = (
  current: StaffRequestNotice[],
  notification: StaffRequestNotice
) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 100);

export const useStaffRequestNotifications = () => {
  const [staffRequestNotice, setStaffRequestNotice] = useState<StaffRequestNotice | null>(null);
  const [staffNotifications, setStaffNotifications] = useState<StaffRequestNotice[]>(loadStaffRequestNotifications);

  const announceIncomingPlayerRequest = useCallback((previousState: AppState, nextState: AppState) => {
    const notifications = getIncomingStaffRequestNotices(previousState, nextState);
    if (!notifications.length) return;
    setStaffRequestNotice(notifications[0]);
    setStaffNotifications((current) => {
      const next = notifications.reduceRight(
        (result, notification) => prependStaffRequestNotification(result, notification),
        current
      );
      saveStaffRequestNotifications(next);
      return next;
    });
  }, []);

  const syncSelfCheckInStaffRequests = useCallback((requests: StaffAssistanceRequest[]) => {
    const pending = requests.filter((request) => request.status === 'pending');
    const pendingIds = new Set(pending.map((request) => request.id));
    const authoritative = pending.map(noticeForWalkInRequest);
    setStaffRequestNotice((current) => {
      if (current?.kind === 'walk-in' && (!current.staffRequestId || !pendingIds.has(current.staffRequestId))) return null;
      return current ?? authoritative[0] ?? null;
    });
    setStaffNotifications((current) => {
      const authoritativeById = new Map(authoritative.map((notice) => [notice.id, notice]));
      const next = [
        ...authoritative.map((notice) => ({
          ...notice,
          read: current.find((candidate) => candidate.id === notice.id)?.read ?? false
        })),
        ...current.filter((notice) => !authoritativeById.has(notice.id))
      ].slice(0, 100);
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
    syncSelfCheckInStaffRequests,
    staffNotifications,
    staffRequestNotice
  };
};
