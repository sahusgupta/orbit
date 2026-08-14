'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { getClubDistance } from '@orbit/player-domain/discovery';
import { filterClubs } from '@/src/domain/selectors';
import type { ClubFilters, PlayerClubSnapshot } from '@/src/domain/types';
import { useLocation } from '@/src/location/location-context';
import { replaceRouteQuery } from '@/src/navigation/query-state';
import { SearchField, SelectField } from '@/src/components/ui/fields';
import { Disclosure } from '@/src/components/ui/disclosure';
import { EmptyState } from '@/src/components/ui/state-panels';
import { ClubCard } from './entity-cards';
import { LocationControl } from './location-control';

export function ClubsExplorer({ clubs }: { clubs: PlayerClubSnapshot[] }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { coordinate } = useLocation();
  const filters = useMemo<ClubFilters>(() => ({
    query: searchParams.get('q') ?? '',
    distance: searchParams.get('distance') ?? '0',
    activity: searchParams.get('activity') ?? 'all'
  }), [searchParams]);
  const matches = useMemo(() => filterClubs(clubs, filters, coordinate), [clubs, coordinate, filters]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all' || value === '0') next.delete(key); else next.set(key, value);
    replaceRouteQuery(pathname, next);
  };
  return (
    <div className="stack-xl">
      <Disclosure title="Refine clubs">
        <div className="inline-filter-bar">
          <SearchField label="Search clubs" value={filters.query} onChange={(event) => update('q', event.target.value)} placeholder="Club, area, or game" />
          <SelectField label="Activity" value={filters.activity} onValueChange={(value) => update('activity', value)} options={[{ value: 'all', label: 'Any activity' }, { value: 'active', label: 'Running games' }, { value: 'forming', label: 'Forming games' }]} />
          <SelectField label="Distance" value={filters.distance} onValueChange={(value) => update('distance', value)} options={[{ value: '0', label: 'Any distance' }, { value: '5', label: 'Within 5 mi' }, { value: '10', label: 'Within 10 mi' }, { value: '20', label: 'Within 20 mi' }, { value: '50', label: 'Within 50 mi' }]} />
        </div>
        <LocationControl />
      </Disclosure>
      <section aria-live="polite">
        <div className="results-summary"><strong>{matches.length}</strong><span>club{matches.length === 1 ? '' : 's'} matched</span></div>
        {matches.length ? <div className="club-grid">{matches.map((club) => <ClubCard key={club.club.id} club={club} distanceMiles={getClubDistance(club, coordinate)} />)}</div> : <EmptyState title="No clubs match those filters" message="Discovery still works without location. Clear the distance filter or try another area." />}
      </section>
    </div>
  );
}
