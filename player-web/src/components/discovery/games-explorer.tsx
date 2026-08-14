'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { filterGames, getGameTypeLabel, getStakesLabel } from '@/src/domain/selectors';
import type { GameFilters, PlayerClubSnapshot } from '@/src/domain/types';
import { useLocation } from '@/src/location/location-context';
import { EmptyState } from '@/src/components/ui/state-panels';
import { SearchField, SelectField } from '@/src/components/ui/fields';
import { Disclosure } from '@/src/components/ui/disclosure';
import { GameCard } from './entity-cards';
import { LocationControl } from './location-control';

const defaults: GameFilters = { query: '', gameType: 'all', stakes: 'all', venue: 'all', status: 'all', distance: '0' };

export function GamesExplorer({ clubs }: { clubs: PlayerClubSnapshot[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { coordinate } = useLocation();
  const filters = useMemo<GameFilters>(() => ({
    query: searchParams.get('q') ?? defaults.query,
    gameType: searchParams.get('type') ?? defaults.gameType,
    stakes: searchParams.get('stakes') ?? defaults.stakes,
    venue: searchParams.get('venue') ?? defaults.venue,
    status: searchParams.get('status') ?? defaults.status,
    distance: searchParams.get('distance') ?? defaults.distance
  }), [searchParams]);
  const listings = useMemo(() => filterGames(clubs, filters, coordinate), [clubs, coordinate, filters]);
  const stakes = useMemo(() => Array.from(new Set(clubs.flatMap((club) => club.games.map(getStakesLabel)))).sort(), [clubs]);
  const gameTypes = useMemo(() => Array.from(new Set(clubs.flatMap((club) => club.games.map((game) => getGameTypeLabel(game).toLowerCase())))).sort(), [clubs]);

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === defaults[key as keyof GameFilters]) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}${next.size ? `?${next.toString()}` : ''}`, { scroll: false });
  };

  return (
    <div className="explorer-layout">
      <aside className="filter-rail" aria-label="Game filters">
        <Disclosure title="Refine games">
          <SearchField label="Search games or clubs" value={filters.query} onChange={(event) => update('q', event.target.value)} placeholder="Game, club, or area" />
          <div className="filter-grid">
            <SelectField label="Status" value={filters.status} onValueChange={(value) => update('status', value)} options={[{ value: 'all', label: 'Any status' }, { value: 'running', label: 'Running now' }, { value: 'forming', label: 'Forming' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'paused', label: 'Paused' }]} />
            <SelectField label="Game" value={filters.gameType} onValueChange={(value) => update('type', value)} options={[{ value: 'all', label: 'Any game' }, ...gameTypes.map((gameType) => ({ value: gameType, label: gameType.toUpperCase() }))]} />
            <SelectField label="Stakes" value={filters.stakes} onValueChange={(value) => update('stakes', value)} options={[{ value: 'all', label: 'Any stakes' }, ...stakes.map((stake) => ({ value: stake, label: stake }))]} />
            <SelectField label="Venue" value={filters.venue} onValueChange={(value) => update('venue', value)} options={[{ value: 'all', label: 'Any venue' }, ...clubs.map((club) => ({ value: club.club.id, label: club.club.name }))]} />
            <SelectField label="Distance" value={filters.distance} onValueChange={(value) => update('distance', value)} options={[{ value: '0', label: 'Any distance' }, { value: '5', label: 'Within 5 mi' }, { value: '10', label: 'Within 10 mi' }, { value: '20', label: 'Within 20 mi' }, { value: '50', label: 'Within 50 mi' }]} />
          </div>
          <LocationControl />
        </Disclosure>
      </aside>
      <section className="results-panel" aria-live="polite">
        <div className="results-summary"><strong>{listings.length}</strong><span>game{listings.length === 1 ? '' : 's'} matched</span></div>
        {listings.length ? <div className="entity-list">{listings.map((listing) => <GameCard key={`${listing.club.club.id}:${listing.game.id}`} listing={listing} />)}</div> : <EmptyState title="No games match those filters" message="Try a wider distance, another venue, or clear the search." />}
      </section>
    </div>
  );
}
