import { resolveProfileForReference } from '../lib/profileRelationships';
import { getDemand } from './operations';
import type { AppState, Interest, InterestStatus, PlayerProfile } from './types';

export type ParticipantCandidate = {
  id: string;
  playerName: string;
  interest?: Interest;
  profile?: PlayerProfile;
  confidence: number;
  reasons: string[];
  source: 'interest';
};

type ParticipantCandidateWithInterest = ParticipantCandidate & { interest: Interest };
type ParticipantCandidateWithoutInterest = ParticipantCandidate & { interest?: undefined };

export const hasParticipantInterest = (
  candidate: ParticipantCandidate
): candidate is ParticipantCandidateWithInterest => candidate.interest !== undefined;

export const lacksParticipantInterest = (
  candidate: ParticipantCandidate
): candidate is ParticipantCandidateWithoutInterest => candidate.interest === undefined;

export const activeInterestStatuses: InterestStatus[] = ['Interested', 'Confirmed Coming', 'Arrived'];
export const inactiveInterestStatuses: InterestStatus[] = ['Declined', 'No-Show', 'Left Before Seated', 'Removed'];

export const getProfileForInterest = (interest: Interest, profiles: PlayerProfile[]) =>
  resolveProfileForReference(interest, profiles);

export const getInClubInterests = (state: AppState) =>
  state.interests.filter((interest) => interest.status === 'Arrived' || interest.status === 'Seated');

const getInClubNames = (state: AppState) =>
  new Set(getInClubInterests(state).map((interest) => interest.playerName));

export function getParticipantPool(state: AppState, gameId: string, seats: number): ParticipantCandidate[] {
  const availabilityScore: Record<InterestStatus, number> = {
    Arrived: 100,
    Seated: 96,
    Interested: 58,
    'Confirmed Coming': 76,
    Declined: 0,
    'No-Show': 0,
    'Left Before Seated': 0,
    Removed: 0
  };
  const available = state.interests.filter((interest) => activeInterestStatuses.includes(interest.status) && interest.gameId === gameId);
  const inClubNames = getInClubNames(state);

  const interestCandidates = available
    .map((interest) => {
      const profile = getProfileForInterest(interest, state.profiles);
      const companions = profile?.usualCompanions ?? [];
      const companionMatches = companions.filter((name) => inClubNames.has(name));
      const gameMatch = interest.gameId === gameId || !!profile?.preferredGameIds.includes(gameId);
      const tagMatches = profile?.preferredTags.filter((tag) =>
        state.sessions.some((session) => session.gameId === gameId && session.tags.includes(tag))
      ) ?? [];
      const buyInAverage =
        profile && profile.typicalBuyInMax > 0
          ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2)
          : 0;
      const buyInScore = buyInAverage ? Math.min(18, Math.round(buyInAverage / 100)) : 0;
      const confidence =
        availabilityScore[interest.status] +
        (gameMatch ? 28 : -18) +
        Math.min(14, tagMatches.length * 7) +
        Math.min(24, companionMatches.length * 8) +
        buyInScore;
      const reasons = [
        interest.status,
        gameMatch ? 'game/stakes fit' : 'alternate game',
        tagMatches.length ? `fits ${tagMatches.join(', ')}` : '',
        companionMatches.length ? `connected to ${companionMatches.join(', ')}` : '',
        buyInAverage ? `$${buyInAverage} typical buy-in` : ''
      ].filter(Boolean);

      return {
        id: interest.id,
        playerName: interest.playerName,
        interest,
        profile,
        confidence,
        reasons,
        source: 'interest' as const
      };
    });

  return interestCandidates
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, seats);
}

export function getLikelyParticipants(state: AppState) {
  const activePlayerNames = getInClubNames(state);

  return state.games
    .flatMap((game) => {
      const demand = getDemand(game, state.interests);
      return state.profiles
        .filter((profile) => !activePlayerNames.has(profile.name))
        .map((profile) => {
          const prefersGame = profile.preferredGameIds.includes(game.id) || profile.preferredStakes.includes(game.name);
          const tagMatches = profile.preferredTags.filter((tag) =>
            state.sessions.some((session) => session.gameId === game.id && session.tags.includes(tag))
          );
          const companionMatches = profile.usualCompanions.filter((name) => activePlayerNames.has(name));
          const buyInAverage =
            profile.typicalBuyInMax > 0 ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2) : 0;
          const confidence =
            (prefersGame ? 55 : 8) +
            demand.totalDemand * 7 +
            companionMatches.length * 18 +
            tagMatches.length * 8 +
            Math.min(20, Math.round(buyInAverage / 100));
          const reason = [
            prefersGame ? `prefers ${game.name}` : `possible ${game.name}`,
            tagMatches.length ? `fits ${tagMatches.join(', ')}` : '',
            demand.totalDemand ? `${demand.totalDemand} already interested` : '',
            companionMatches.length ? `connected to ${companionMatches.join(', ')}` : '',
            demand.needs ? `needs ${demand.needs}` : 'table viable'
          ].filter(Boolean);

          return {
            id: `${profile.id}-${game.id}`,
            profile,
            game,
            confidence,
            reason,
            message: `${profile.name}, ${game.name} is close to forming. ${demand.totalDemand} players are already in or interested. Would you want a seat if it starts?`
          };
        });
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}
