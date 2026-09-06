'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { useAuth } from '@/src/auth/auth-context';
import { usePlayerData } from '@/src/data/player-data-context';
import { filterTournaments } from '@/src/domain/selectors';
import type { DiscoveryPayload, TournamentFilters } from '@/src/domain/types';
import { useLocation } from '@/src/location/location-context';
import { replaceRouteQuery } from '@/src/navigation/query-state';
import { SearchField, SelectField } from '@/src/components/ui/fields';
import { Disclosure } from '@/src/components/ui/disclosure';
import { EmptyState } from '@/src/components/ui/state-panels';
import { TournamentCard } from './entity-cards';
import { LocationControl } from './location-control';

export function TournamentsExplorer({ discovery }: { discovery: DiscoveryPayload }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const { user } = useAuth();
  const playerData = usePlayerData();
  const { coordinate } = useLocation();
  const source = user && playerData.status === 'ready' ? playerData : discovery;
  const filters = useMemo<TournamentFilters>(() => ({
    query: searchParams.get('q') ?? '',
    club: searchParams.get('club') ?? 'all',
    distance: '0',
    interest: searchParams.get('interest') ?? 'all'
  }), [searchParams]);
  const matches = useMemo(() => filterTournaments(source, filters, user?.uid ?? '', coordinate), [coordinate, filters, source, user?.uid]);
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all' || value === '0') next.delete(key); else next.set(key, value);
    replaceRouteQuery(pathname, next);
  };
  return (
    <div className="stack-xl">
      <Disclosure title="Refine events">
        <div className="inline-filter-bar">
          <SearchField label="Search tournaments" value={filters.query} onChange={(event) => update('q', event.target.value)} placeholder="Event, club, or prize" />
          <SelectField label="Interest" value={filters.interest} onValueChange={(value) => update('interest', value)} options={[{ value: 'all', label: 'All events' }, { value: 'open', label: 'Interest open' }, ...(user ? [{ value: 'interested', label: 'Events I’m interested in' }] : [])]} />
          <SelectField label="Club" value={filters.club} onValueChange={(value) => update('club', value)} options={[{ value: 'all', label: 'Any club' }, ...source.clubs.map((club) => ({ value: club.club.id, label: club.club.name }))]} />
        </div>
        <LocationControl />
      </Disclosure>
      <section aria-live="polite">
        <div className="results-summary"><strong>{matches.length}</strong><span>event{matches.length === 1 ? '' : 's'} matched</span></div>
        {matches.length ? <div className="tournament-list">{matches.map((listing) => <TournamentCard key={`${listing.tournament.clubId}:${listing.tournament.id}`} listing={listing} />)}</div> : <EmptyState title="No tournaments match those filters" message="Try another club or include events with closed interest." />}
      </section>
    </div>
  );
}
