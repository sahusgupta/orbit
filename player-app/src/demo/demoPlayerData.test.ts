import { describe, expect, it } from 'vitest';
import {
  buildFindGameClubs,
  buildGameOpportunities,
  filterMapClubs,
  filterTournaments,
  getClubCity,
  getClubCoordinate
} from '../domain/discovery';
import {
  decodePlayerClubSnapshot,
  decodePlayerTournament,
  decodeTournamentInterest
} from '../domain/decoders/playerBoundaryDecoders';
import {
  isActivePlayerGameRequest,
  isMembershipCurrentlyActive,
  isPlayerMembership,
  isPlayerWaitlistEntry,
  isTournamentInterestOpen
} from '../domain/playerSync';
import { createDemoPlayerData } from './demoPlayerData';

const nowMs = Date.parse('2026-10-11T12:00:00.000Z');

describe('Local demo player data', () => {
  it('provides fictional venues across four searchable, mapped cities with different games', () => {
    const { clubs } = createDemoPlayerData(nowMs);
    expect(clubs.map(getClubCity)).toEqual(['Austin', 'Chicago', 'Denver', 'Las Vegas']);
    expect(new Set(clubs.map((club) => JSON.stringify(getClubCoordinate(club)))).size).toBe(4);
    for (const club of clubs) {
      expect(club.club.address).toContain('Fictional venue');
      expect(getClubCoordinate(club)).not.toBeNull();
      expect(club.games.length).toBeGreaterThanOrEqual(2);
      expect(new Set(club.games.map((game) => game.name)).size).toBe(club.games.length);
    }
    expect(filterMapClubs(clubs, 'Chicago', 'none', 'all', null).map((club) => getClubCity(club)))
      .toEqual(['Chicago']);
    expect(filterMapClubs(clubs, '', 5, 'all', clubs[0].club.coordinate ?? null).map((club) => getClubCity(club)))
      .toEqual(['Austin']);
    expect(new Set(clubs.flatMap((club) => club.games.flatMap((game) => game.openTables.map((table) => table.status)))))
      .toEqual(new Set(['Running', 'Forming', 'Paused']));
  });

  it('uses fictional sample content without a demo label in displayed names or copy', () => {
    const { player, clubs, tournaments } = createDemoPlayerData(nowMs);
    expect(player.name).toBe('Alex Example');
    expect(player.email).toBe('alex@example.test');
    expect(clubs.map((club) => club.club.name)).toEqual([
      'Wonderland Card House',
      'Moonbeam Poker Club',
      'Cloud Nine Card House',
      'Stardust Sandbox Casino'
    ]);
    expect(tournaments.map((event) => event.name)).toEqual([
      'Pocket Aces Freeroll',
      'Moonlight Omaha Evening',
      'Cloud Nine Mixed Game Meetup',
      'Stardust Holdem Deep Stack'
    ]);
    const displayedCopy = [
      player.name,
      player.email,
      player.homeLocation,
      player.typicalAvailability,
      ...clubs.flatMap((club) => [
        club.club.name,
        club.club.address,
        ...(club.club.membershipOptions ?? []).flatMap((option) => [option.name, option.priceLabel, option.description]),
        ...club.games.flatMap((game) => [game.name, ...game.openTables.flatMap((table) => [table.label, ...table.tags])]),
        ...club.memberships.flatMap((membership) => [membership.playerName, membership.planName, membership.clubNote]),
        ...club.waitlists.map((entry) => entry.playerName)
      ]),
      ...tournaments.flatMap((event) => [event.name, event.prizePoolLabel, ...event.rules])
    ];
    for (const copy of displayedCopy) expect(copy ?? '').not.toMatch(/\bdemo\b/i);
    for (const club of clubs) {
      expect(club.club.address).toMatch(/^Fictional venue, /);
      expect(club.games.every((game) => game.openTables.every((table) => table.tags.includes('Fictional practice game')))).toBe(true);
      for (const option of club.club.membershipOptions ?? []) {
        expect(option.priceLabel).toBe('$0 · sample only');
        expect(option.description).toMatch(/^Fictional membership/);
      }
      for (const membership of club.memberships) expect(membership.clubNote).toBe('Fictional membership. No venue access.');
    }
    for (const event of tournaments) {
      expect(event.prizePoolLabel).toBe('Fictional prize pool');
      expect(event.rules).toContain('Fictional event; no real entry, payment, or prize.');
    }
  });

  it('loads a confirmed My Games request while retaining discoveries in every demo venue', () => {
    const { player, clubs } = createDemoPlayerData(nowMs);
    const memberships = clubs.flatMap((club) => club.memberships.filter((membership) => isPlayerMembership(membership, player)));
    const joinedClubIds = new Set(memberships.filter((membership) => isMembershipCurrentlyActive(membership, nowMs)).map((membership) => membership.clubId));
    const myGames = clubs.flatMap((club) => club.waitlists
      .filter((entry) => isPlayerWaitlistEntry(entry, player) && isActivePlayerGameRequest(entry))
      .flatMap((entry) => {
        const game = club.games.find((candidate) => candidate.id === entry.gameId);
        return game ? [{ club, game, entry }] : [];
      }));
    expect(myGames).toHaveLength(1);
    expect(myGames[0].entry.status).toBe('Confirmed Coming');
    expect(joinedClubIds.size).toBe(2);

    const opportunities = buildGameOpportunities({
      activePlayerGameKeys: new Set(myGames.map(({ club, game }) => `${club.club.id}:${game.id}`)),
      distanceFilter: 'none',
      favoriteClubIds: player.favoriteClubIds ?? [],
      findGameClubs: buildFindGameClubs(clubs),
      fitScoreFilterEnabled: false,
      gameQuery: '',
      gameTypeFilter: 'all',
      joinedClubIds,
      nowMs,
      player,
      playerHomeCoordinate: null,
      selectedCasinoFilter: 'all',
      selectedFilterClubId: 'all',
      stakesFilter: ''
    });
    expect(opportunities).toHaveLength(7);
    expect(new Set(opportunities.map((item) => getClubCity(item.club))).size).toBe(4);
    expect(opportunities.some((item) => item.isPreferred)).toBe(true);
    expect(opportunities.filter((item) => item.isJoined).every((item) => item.seatRequestAccess === 'active')).toBe(true);
    expect(opportunities.some((item) => item.seatRequestAccess === 'missing')).toBe(true);
  });

  it.each([nowMs, Date.parse('2055-07-20T12:00:00.000Z')])('refreshes active memberships and upcoming events for entry at %s', (entryTime) => {
    const { player, clubs, tournaments, tournamentInterests } = createDemoPlayerData(entryTime);
    const memberships = clubs.flatMap((club) => club.memberships);
    expect(memberships).toHaveLength(2);
    expect(memberships.every((membership) => isMembershipCurrentlyActive(membership, entryTime))).toBe(true);
    expect(memberships.every((membership) => Date.parse(membership.expiresAt ?? '') > entryTime)).toBe(true);
    expect(tournaments.every((tournament) => isTournamentInterestOpen(tournament, entryTime))).toBe(true);
    // Daily refresh has a full day's headroom before any demo interest closes.
    expect(tournaments.every((tournament) => isTournamentInterestOpen(tournament, entryTime + 24 * 60 * 60 * 1000))).toBe(true);
    const options = {
      clubs,
      originCoordinate: null,
      playerId: player.id,
      query: '',
      interests: tournamentInterests,
      nowMs: entryTime,
      tournamentClubFilter: 'all',
      tournamentDistanceFilter: 'none' as const,
      tournamentFilter: 'open' as const,
      tournaments
    };
    expect(filterTournaments(options)).toHaveLength(4);
    expect(filterTournaments({ ...options, tournamentFilter: 'interested' })).toHaveLength(1);
    expect(filterTournaments({ ...options, tournamentFilter: 'free' })).toHaveLength(1);
  });

  it('keeps all fixtures compatible with existing player boundary decoders', () => {
    const { clubs, tournaments, tournamentInterests } = createDemoPlayerData(nowMs);
    for (const club of clubs) {
      const decoded = decodePlayerClubSnapshot(club);
      expect(decoded?.games).toHaveLength(club.games.length);
      expect(decoded?.memberships).toHaveLength(club.memberships.length);
      expect(decoded?.waitlists).toHaveLength(club.waitlists.length);
      expect(decoded?.club.coordinate).toEqual(club.club.coordinate);
    }
    expect(tournaments.map(decodePlayerTournament).every(Boolean)).toBe(true);
    expect(tournamentInterests.map(decodeTournamentInterest).every(Boolean)).toBe(true);
  });

  it('restores stable IDs and fresh nested objects after a demo was changed', () => {
    const expected = createDemoPlayerData(nowMs);
    const changed = createDemoPlayerData(nowMs);
    changed.player.favoriteClubIds?.push('demo-added');
    changed.player.preferredGameIds.length = 0;
    changed.clubs[0].club.coordinate!.latitude = 0;
    changed.clubs[0].games[0].openTables[0].social.seatedPlayerCount = 0;
    changed.clubs[0].games[0].openTables[0].tags.push('changed');
    changed.clubs[0].memberships.length = 0;
    changed.clubs[0].waitlists.length = 0;
    changed.tournaments[0].rules.push('changed');
    changed.tournamentInterests.length = 0;
    expect(createDemoPlayerData(nowMs)).toEqual(expected);
    expect(changed).not.toEqual(expected);

    const membershipIds = expected.clubs.flatMap((club) => club.memberships.map((membership) => membership.id));
    expect(membershipIds).toEqual(['sample-austin-membership', 'sample-chicago-membership']);
    const internalIds = [
      expected.player.id,
      ...expected.clubs.flatMap((club) => [
        club.club.id,
        ...(club.club.membershipOptions ?? []).map((option) => option.id),
        ...club.games.flatMap((game) => [game.id, ...game.openTables.map((table) => table.id)]),
        ...club.waitlists.map((entry) => entry.id)
      ]),
      ...expected.tournaments.map((tournament) => tournament.id),
      ...expected.tournamentInterests.map((interest) => interest.id)
    ];
    expect(internalIds.every((id) => id.startsWith('demo-'))).toBe(true);
    const ids = [...internalIds, ...membershipIds];
    expect(new Set(ids).size).toBe(ids.length);
  });
});
