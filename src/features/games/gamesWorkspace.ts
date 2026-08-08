import { useState } from 'react';
import type { GroupMeCandidateResult } from '../../lib/resultBuilders';

export type CoordinationConfig = {
  gameId: string;
  seats: number;
};

export type GroupMeCandidate = GroupMeCandidateResult;

export const useGamesWorkspaceState = () => {
  const [groupMeText, setGroupMeText] = useState('');
  const [groupMeCandidates, setGroupMeCandidates] = useState<GroupMeCandidate[]>([]);
  const [gameFormatFilter, setGameFormatFilter] = useState('All formats');
  const [gameStakesFilter, setGameStakesFilter] = useState('All stakes');
  const [gameStatusFilter, setGameStatusFilter] = useState('All statuses');
  const [coordinationConfig, setCoordinationConfig] = useState<CoordinationConfig>({
    gameId: 'nlh-1-2',
    seats: 10
  });

  return {
    coordinationConfig,
    gameFormatFilter,
    gameStakesFilter,
    gameStatusFilter,
    groupMeCandidates,
    groupMeText,
    setCoordinationConfig,
    setGameFormatFilter,
    setGameStakesFilter,
    setGameStatusFilter,
    setGroupMeCandidates,
    setGroupMeText
  };
};
