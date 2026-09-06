import type { PlayerClubSnapshot } from './playerSync';

export type PlayerLiveDataStatus = 'idle' | 'loading' | 'ready' | 'error';

export type PlayerClubsViewState =
  | { kind: 'loading' }
  | { kind: 'offline' }
  | { kind: 'empty' }
  | { kind: 'stale'; selectedClub: PlayerClubSnapshot; partial: boolean }
  | { kind: 'removed'; selectedClub?: PlayerClubSnapshot; message: string; partial: boolean }
  | { kind: 'ready'; selectedClub: PlayerClubSnapshot; partial: boolean };

export function reconcileSelectedClubAfterRefresh(
  selectedClubId: string,
  liveClubs: PlayerClubSnapshot[],
  fallbackClubId = ''
) {
  if (selectedClubId && liveClubs.some((club) => club.club.id === selectedClubId)) {
    return { selectedClubId, selectionNotice: '' };
  }
  if (selectedClubId) {
    return {
      selectedClubId: '',
      selectionNotice: 'The previously selected club is no longer available.'
    };
  }
  return { selectedClubId: fallbackClubId, selectionNotice: '' };
}

export function deriveClubsViewState(
  liveDataStatus: PlayerLiveDataStatus,
  memberClubs: PlayerClubSnapshot[],
  selectedClub: PlayerClubSnapshot | undefined,
  partial: boolean,
  selectionNotice: string
): PlayerClubsViewState {
  if (liveDataStatus === 'loading' && memberClubs.length === 0) return { kind: 'loading' };
  if (liveDataStatus === 'error' && memberClubs.length === 0) return { kind: 'offline' };
  if (selectionNotice) {
    return { kind: 'removed', ...(selectedClub ? { selectedClub } : {}), message: selectionNotice, partial };
  }
  if (memberClubs.length === 0 || !selectedClub) return { kind: 'empty' };
  if (liveDataStatus === 'error') return { kind: 'stale', selectedClub, partial };
  return { kind: 'ready', selectedClub, partial };
}
