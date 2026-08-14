import type { MetadataRoute } from 'next';
import { clubRouteKey, flattenGames, gameRouteKey, tournamentRouteKey } from '@/src/domain/selectors';
import { getPublicDiscovery } from '@/src/server/public-data';
import { absoluteUrl } from '@/src/seo/site';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl('/'), changeFrequency: 'hourly', priority: 1 },
    { url: absoluteUrl('/games'), changeFrequency: 'hourly', priority: 0.9 },
    { url: absoluteUrl('/clubs'), changeFrequency: 'hourly', priority: 0.9 },
    { url: absoluteUrl('/tournaments'), changeFrequency: 'hourly', priority: 0.9 },
    { url: absoluteUrl('/privacy'), changeFrequency: 'monthly', priority: 0.4 }
  ];
  const result = await getPublicDiscovery();
  if (result.status !== 'ready') return staticRoutes;
  const clubRoutes = result.data.clubs.map((club) => ({
    url: absoluteUrl(`/clubs/${clubRouteKey(club)}`),
    changeFrequency: 'hourly' as const,
    priority: 0.8
  }));
  const gameRoutes = flattenGames(result.data.clubs).map(({ club, game }) => ({
    url: absoluteUrl(`/games/${gameRouteKey(club, game)}`),
    changeFrequency: 'hourly' as const,
    priority: 0.8
  }));
  const tournamentRoutes = result.data.tournaments.map((tournament) => {
    const club = result.data.clubs.find((candidate) => candidate.club.id === tournament.clubId);
    return {
      url: absoluteUrl(`/tournaments/${tournamentRouteKey(club, tournament)}`),
      changeFrequency: 'daily' as const,
      priority: 0.8
    };
  });
  return [...staticRoutes, ...clubRoutes, ...gameRoutes, ...tournamentRoutes];
}
