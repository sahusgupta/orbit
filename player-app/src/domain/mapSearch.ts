import type { PlayerClubSnapshot } from './playerSync';

function searchWords(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Search only published venue information; typing never resolves a device or geocoded location. */
export function searchMapClubs(clubs: readonly PlayerClubSnapshot[], query: string): PlayerClubSnapshot[] {
  const words = searchWords(query);
  if (!words.length) return [...clubs];
  const matches = (value: string) => {
    const publishedWords = searchWords(value);
    return words.every((word) => publishedWords.some((publishedWord) => publishedWord.includes(word)));
  };
  const locationMatches = clubs.filter((club) => matches(club.club.address ?? ''));
  if (locationMatches.length) return locationMatches;
  return clubs.filter((club) => matches(`${club.club.name} ${club.club.address ?? ''} ${club.games.map((game) => game.name).join(' ')}`));
}
