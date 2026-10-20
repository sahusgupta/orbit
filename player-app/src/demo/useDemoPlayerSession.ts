import { useEffect, useRef, useState } from 'react';
import { playerPlatform } from '../app/playerPlatform';
import type { PlayerSessionLiveData, PlayerSessionStorage } from '../application/playerSession';
import type { OnboardingStep } from '../domain/playerTypes';
import { createDemoPlayerData } from './demoPlayerData';

const dayInMs = 24 * 60 * 60 * 1000;

export function useDemoPlayerSession() {
  const [initialData] = useState(() => createDemoPlayerData());
  const [player, setPlayer] = useState(initialData.player);
  const [draftPlayer, setDraftPlayer] = useState(initialData.player);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(0);
  const [clubs, setClubs] = useState(initialData.clubs);
  const [tournaments, setTournaments] = useState(initialData.tournaments);
  const [tournamentInterests, setTournamentInterests] = useState(initialData.tournamentInterests);
  const [selectedClubId, setSelectedClubId] = useState(initialData.clubs[0].club.id);
  const [clockNow, setClockNow] = useState(Date.now());
  const [clubMembershipMessage, setClubMembershipMessage] = useState('');
  const [clubSelectionNotice, setClubSelectionNotice] = useState('');
  const [dismissedNotificationIds, setDismissedNotificationIds] = useState<string[]>([]);
  const fixtureDay = useRef(Math.floor(clockNow / dayInMs));

  const refreshGames = (nowMs = Date.now()) => {
    const data = createDemoPlayerData(nowMs);
    fixtureDay.current = Math.floor(nowMs / dayInMs);
    setClockNow(nowMs);
    setClubs(data.clubs);
    setTournaments(data.tournaments);
    setTournamentInterests(data.tournamentInterests);
    setSelectedClubId(data.clubs[0].club.id);
    setClubMembershipMessage('');
    setClubSelectionNotice('');
    setDismissedNotificationIds([]);
  };

  useEffect(() => {
    const updateClock = () => {
      const nowMs = Date.now();
      setClockNow(nowMs);
      // Keep sample events upcoming even when the preview stays open overnight.
      if (fixtureDay.current !== Math.floor(nowMs / dayInMs)) refreshGames(nowMs);
    };
    const interval = setInterval(updateClock, 60_000);
    const unsubscribe = playerPlatform.subscribeToAppState((state) => {
      if (state === 'active') updateClock();
    });
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, []);

  const storage: PlayerSessionStorage = {
    accountLoaded: true,
    dismissedAlertsLoaded: true,
    dismissedNotificationIds,
    dismissInAppAlert: (id) => setDismissedNotificationIds((current) => [...new Set([...current, id])]),
    draftPlayer,
    hasAccount: true,
    onboardingStep,
    player,
    playerStorageError: '',
    retryPlayerStorage: () => refreshGames(),
    setDraftPlayer,
    setOnboardingStep,
    setPlayer
  };

  const liveData: PlayerSessionLiveData = {
    clockNow,
    clubMembershipMessage,
    clubSelectionNotice,
    clubs,
    liveDataPartial: false,
    liveDataStatus: 'ready',
    profileEditingReady: true,
    profileSyncNotice: '',
    retryLiveData: () => refreshGames(),
    selectedClubId,
    setClubMembershipMessage,
    setClubSelectionNotice,
    setClubs,
    setSelectedClubId,
    setTournamentInterests,
    tournamentInterests,
    tournamentDataStatus: 'ready',
    tournamentDataPartial: false,
    tournamentLoadError: '',
    tournaments
  };

  return { storage, liveData };
}
