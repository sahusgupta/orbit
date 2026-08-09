import { useState, type Dispatch, type SetStateAction } from 'react';
import type { PlayerAccount, PlayerPrivateGameListing } from '../domain/playerSync';
import type { PrivateGameDraft, Screen } from '../domain/playerTypes';
import { submitPrivateGameListing } from '../data/orbitSyncApi';

export const emptyPrivateGameDraft: PrivateGameDraft = {
  name: '',
  location: '',
  startsAt: '',
  seats: '6',
  note: ''
};

type UsePlayerPrivateGamesOptions = {
  hasPlayerPremium: boolean;
  player: PlayerAccount;
  requireVerifiedAge(returnScreen: Screen, action: string): boolean;
  setPremiumMessage: Dispatch<SetStateAction<string>>;
  setPrivateGames: Dispatch<SetStateAction<PlayerPrivateGameListing[]>>;
  setPrivateGameStatus: Dispatch<SetStateAction<string>>;
};

export function usePlayerPrivateGames({
  hasPlayerPremium,
  player,
  requireVerifiedAge,
  setPremiumMessage,
  setPrivateGames,
  setPrivateGameStatus
}: UsePlayerPrivateGamesOptions) {
  const [privateGameDraft, setPrivateGameDraft] = useState<PrivateGameDraft>(emptyPrivateGameDraft);

  const publishPrivateGame = async () => {
    if (!requireVerifiedAge('findGames', 'hosting a game')) return;
    if (!hasPlayerPremium) {
      setPrivateGameStatus('Player hosting requires Player Premium.');
      setPremiumMessage('Upgrade to Player Premium to host private games.');
      return;
    }
    const name = privateGameDraft.name.trim();
    const location = privateGameDraft.location.trim();
    if (!name || !location) return;
    const createdAt = new Date().toISOString();
    const listing: PlayerPrivateGameListing = {
      id: `private_${player.id || 'player'}_${Date.now()}`,
      name,
      location,
      startsAt: privateGameDraft.startsAt.trim() || 'Tonight',
      seats: privateGameDraft.seats.trim() || '6',
      note: privateGameDraft.note.trim(),
      hostPlayerId: player.id,
      hostPlayerPath: `players/${player.id}`,
      hostPlayerName: player.name,
      createdAt,
      status: 'Open'
    };
    setPrivateGameStatus('Listing private game...');
    const result = await submitPrivateGameListing(listing);
    if (!result.ok) {
      setPrivateGameStatus(result.error);
      return;
    }
    setPrivateGames((current) => [result.game, ...current.filter((game) => game.id !== result.game.id)]);
    setPrivateGameStatus('Private game listed.');
    setPrivateGameDraft(emptyPrivateGameDraft);
  };

  return { privateGameDraft, publishPrivateGame, setPrivateGameDraft };
}
