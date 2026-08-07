type InterestStatus =
  | 'Interested'
  | 'Confirmed Coming'
  | 'Arrived'
  | 'Seated'
  | 'Declined'
  | 'No-Show'
  | 'Left Before Seated'
  | 'Removed';

type BalanceGame = {
  id: string;
  name: string;
  maxSeats: number;
};

type BalanceInterest = {
  id: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
};

type BalanceProfile = {
  preferredGameIds: string[];
  preferredStakes: string;
  typicalBuyInMin: number;
  typicalBuyInMax: number;
  willingnessToMove: boolean;
  usualCompanions: string[];
};

type BalanceSession = {
  seatsFilled: number;
  maxSeats: number;
};

type BalanceDemand = {
  confirmed: number;
  waiting: number;
  interested: number;
  totalDemand: number;
};

type BalanceState<Game, Interest, Profile> = {
  games: Game[];
  interests: Interest[];
  profiles: Profile[];
};

type BalanceCandidate<Interest, Profile> = {
  id: string;
  playerName: string;
  interest: Interest;
  profile: Profile | undefined;
  confidence: number;
  reasons: string[];
  source: 'interest';
};

export type BalancePlanResult<Game, Demand, Session, Interest, Profile> = {
  game: Game;
  demand: Demand;
  fromTable: Session;
  moveCandidates: BalanceCandidate<Interest, Profile>[];
  tableASeatsAfterMove: number;
  tableBProjectedSeats: number;
  nextStep: string;
};

const isNotNull = <Value>(value: Value | null): value is Value => value !== null;

export function getBalancePlans<
  Game extends BalanceGame,
  Interest extends BalanceInterest,
  Profile extends BalanceProfile,
  Session extends BalanceSession,
  Demand extends BalanceDemand,
  State extends BalanceState<Game, Interest, Profile>
>(
  state: State,
  operations: {
    getDemand: (game: Game, interests: Interest[]) => Demand;
    getRunningSessions: (state: State, gameId: string) => Session[];
    getProfileForInterest: (interest: Interest, profiles: Profile[]) => Profile | undefined;
  }
): BalancePlanResult<Game, Demand, Session, Interest, Profile>[] {
  return state.games
    .map((game): BalancePlanResult<Game, Demand, Session, Interest, Profile> | null => {
      const demand = operations.getDemand(game, state.interests);
      const runningTables = operations
        .getRunningSessions(state, game.id)
        .filter((session) => session.seatsFilled >= Math.min(7, session.maxSeats));
      const fromTable = runningTables[0];
      if (!fromTable || demand.totalDemand <= 12) return null;

      const flexibleDemand = demand.confirmed + demand.waiting + demand.interested;
      const inRoomCandidates = state.interests
        .filter((interest) => interest.gameId === game.id && interest.status === 'Arrived')
        .map((interest): BalanceCandidate<Interest, Profile> => {
          const profile = operations.getProfileForInterest(interest, state.profiles);
          const connectedNames = profile?.usualCompanions.filter((name) =>
            state.interests.some(
              (other) =>
                other.playerName === name &&
                other.gameId === game.id &&
                ['Arrived', 'Confirmed Coming', 'Interested'].includes(other.status)
            )
          ) ?? [];
          const buyInAverage =
            profile && profile.typicalBuyInMax > 0
              ? Math.round((profile.typicalBuyInMin + profile.typicalBuyInMax) / 2)
              : 0;
          const confidence =
            (profile?.preferredGameIds.includes(game.id) || profile?.preferredStakes.includes(game.name) ? 35 : 10) +
            (profile?.willingnessToMove ? 35 : -15) +
            connectedNames.length * 20 +
            Math.min(20, Math.round(buyInAverage / 100));

          return {
            id: interest.id,
            playerName: interest.playerName,
            interest,
            profile,
            confidence,
            reasons: [
              profile?.willingnessToMove ? 'willing to move' : 'ask before moving',
              connectedNames.length ? `connected to ${connectedNames.join(', ')}` : '',
              buyInAverage ? `$${buyInAverage} typical buy-in` : '',
              profile?.preferredStakes || game.name
            ].filter(Boolean),
            source: 'interest'
          };
        })
        .sort((left, right) => right.confidence - left.confidence);

      const minimumTableASeats = Math.min(6, fromTable.maxSeats);
      const projectedTableBTarget = Math.min(game.maxSeats, Math.floor(demand.totalDemand / 2));
      const moveNeeded = Math.max(2, projectedTableBTarget - flexibleDemand);
      const maxMovable = Math.max(0, fromTable.seatsFilled - minimumTableASeats);
      const moveCount = Math.min(inRoomCandidates.length, maxMovable, moveNeeded);
      const moveCandidates = inRoomCandidates.slice(0, moveCount);

      if (!moveCandidates.length) return null;

      return {
        game,
        demand,
        fromTable,
        moveCandidates,
        tableASeatsAfterMove: fromTable.seatsFilled - moveCandidates.length,
        tableBProjectedSeats: flexibleDemand + moveCandidates.length,
        nextStep: `${game.name}: move ${moveCandidates.map((candidate) => candidate.playerName).join(', ')} to seed Table B`
      };
    })
    .filter(isNotNull);
}

type GroupMeGame = {
  id: string;
  name: string;
};

export type GroupMeCandidateResult = {
  id: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
  timestamp: string;
  confidence: number;
  sourceText: string;
};

export function parseGroupMeMessages<Game extends GroupMeGame>(
  text: string,
  games: Game[],
  generators: {
    createId: () => string;
    getTimestamp: () => string;
  }
): GroupMeCandidateResult[] {
  const statusFromLine = (line: string): InterestStatus =>
    /on my way|coming|eta|be there/i.test(line)
      ? 'Confirmed Coming'
      : /here|arrived|in room|at the room/i.test(line)
        ? 'Arrived'
        : 'Interested';

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line): GroupMeCandidateResult | null => {
      const matchedGame =
        games.find((game) => line.toLowerCase().includes(game.name.toLowerCase())) ??
        games.find((game) => game.name.includes('1/2') && /\b1\s*\/\s*2\b|1-2/i.test(line)) ??
        games.find((game) => game.name.includes('2/5') && /\b2\s*\/\s*5\b|2-5/i.test(line)) ??
        games.find((game) => game.name.toLowerCase().includes('plo') && /plo/i.test(line));
      if (!matchedGame) return null;
      const nameMatch = line.match(/^([A-Za-z][A-Za-z .'-]{1,32})[:\-]/) ?? line.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,32})\b/i);
      const playerName = (nameMatch?.[1] ?? line.split(/\s+/)[0] ?? 'Unknown').trim();
      const confidence = /interested|play|seat|list|coming|eta|arrived|here|in/i.test(line) ? 82 : 62;
      return {
        id: generators.createId(),
        playerName,
        gameId: matchedGame.id,
        status: statusFromLine(line),
        timestamp: generators.getTimestamp(),
        confidence,
        sourceText: line
      };
    })
    .filter(isNotNull);
}

type TodayInterest = {
  id: string;
  profileId?: string;
  playerName: string;
  gameId: string;
  status: InterestStatus;
  timestamp: string;
  interestedAt: string;
  confirmedAt?: string;
  arrivedAt?: string;
  seatedAt?: string;
  closedAt?: string;
};

type TodayProfile = {
  id: string;
  name: string;
  membershipStatus?: string;
  membershipExpiresAt?: string;
  membershipExpirationDate: string;
};

type TodayPlayerSession = {
  id: string;
  playerName: string;
  profileId?: string;
  gameId: string;
  tableId: string;
  seatNumber?: number;
  seatedAt: string;
  leftAt?: string;
};

type TodayGame = {
  id: string;
  name: string;
};

type TodaySession = {
  id: string;
  label: string;
};

type TodayActivityState<Interest, Profile, PlayerSession, Game, Session> = {
  interests: Interest[];
  profiles: Profile[];
  playerSessions: PlayerSession[];
  games: Game[];
  sessions: Session[];
};

export type TodayPlayerRowResult = {
  id: string;
  playerName: string;
  profileId?: string;
  status: InterestStatus;
  gameName: string;
  tableLabel?: string;
  seatNumber?: number;
  timestamp: string;
  activeMember: boolean;
};

const closedInterestStatuses: InterestStatus[] = ['Seated', 'Declined', 'No-Show', 'Left Before Seated', 'Removed'];

export function getTodayPlayerActivity<
  Interest extends TodayInterest,
  Profile extends TodayProfile,
  PlayerSession extends TodayPlayerSession,
  Game extends TodayGame,
  Session extends TodaySession
>(
  state: TodayActivityState<Interest, Profile, PlayerSession, Game, Session>,
  options: {
    currentDate: Date;
    toLocalDateValue: (date: Date) => string;
    isFutureDate: (value?: string) => boolean;
  }
): TodayPlayerRowResult[] {
  const currentDate = options.toLocalDateValue(options.currentDate);
  const isToday = (value?: string) => {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && options.toLocalDateValue(date) === currentDate;
  };
  const getInterestTimestamp = (interest: Interest) => {
    if (interest.status === 'Seated') return interest.seatedAt ?? interest.arrivedAt ?? interest.timestamp;
    if (interest.status === 'Arrived') return interest.arrivedAt ?? interest.confirmedAt ?? interest.timestamp;
    if (interest.status === 'Confirmed Coming') return interest.confirmedAt ?? interest.timestamp;
    if (closedInterestStatuses.includes(interest.status)) return interest.closedAt ?? interest.timestamp;
    return interest.interestedAt || interest.timestamp;
  };
  const findProfile = (profileId: string | undefined, playerName: string) =>
    state.profiles.find((profile) => profile.id === profileId || profile.name.toLowerCase() === playerName.toLowerCase());
  const findLatestSession = (profileId: string | undefined, playerName: string) =>
    state.playerSessions
      .filter((session) => session.profileId === profileId || session.playerName.toLowerCase() === playerName.toLowerCase())
      .sort((left, right) => new Date(right.seatedAt).getTime() - new Date(left.seatedAt).getTime())[0];

  const rows = state.interests
    .map((interest): TodayPlayerRowResult | null => {
      const timestamp = getInterestTimestamp(interest);
      if (!isToday(timestamp)) return null;
      const profile = findProfile(interest.profileId, interest.playerName);
      const playerSession = findLatestSession(interest.profileId, interest.playerName);
      const table = playerSession ? state.sessions.find((session) => session.id === playerSession.tableId) : undefined;
      return {
        id: `interest-${interest.id}`,
        playerName: interest.playerName,
        profileId: interest.profileId,
        status: interest.status,
        gameName: state.games.find((game) => game.id === interest.gameId)?.name ?? 'Unknown game',
        tableLabel: interest.status === 'Seated' ? table?.label : undefined,
        seatNumber: interest.status === 'Seated' ? playerSession?.seatNumber : undefined,
        timestamp,
        activeMember: Boolean(
          profile &&
          profile.membershipStatus !== 'Requested' &&
          options.isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate)
        )
      };
    })
    .filter(isNotNull);

  state.playerSessions
    .filter((session) => !session.leftAt && isToday(session.seatedAt))
    .forEach((session) => {
      const alreadyListed = rows.some((row) =>
        (session.profileId && row.profileId === session.profileId) ||
        row.playerName.toLowerCase() === session.playerName.toLowerCase()
      );
      if (alreadyListed) return;
      const profile = findProfile(session.profileId, session.playerName);
      const table = state.sessions.find((candidate) => candidate.id === session.tableId);
      rows.push({
        id: `session-${session.id}`,
        playerName: session.playerName,
        profileId: session.profileId,
        status: 'Seated',
        gameName: state.games.find((game) => game.id === session.gameId)?.name ?? 'Unknown game',
        tableLabel: table?.label,
        seatNumber: session.seatNumber,
        timestamp: session.seatedAt,
        activeMember: Boolean(
          profile &&
          profile.membershipStatus !== 'Requested' &&
          options.isFutureDate(profile.membershipExpiresAt || profile.membershipExpirationDate)
        )
      });
    });

  const statusOrder: Record<InterestStatus, number> = {
    Seated: 0,
    Arrived: 1,
    'Confirmed Coming': 2,
    Interested: 3,
    Declined: 4,
    'No-Show': 5,
    'Left Before Seated': 6,
    Removed: 7
  };
  return rows.sort((left, right) =>
    statusOrder[left.status] - statusOrder[right.status] ||
    new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
  );
}
