import { getClubDistance, isUpcomingTournament } from './discovery';
import { getPlayerSeatRequestAccess, type PlayerAccount, type PlayerClubSnapshot, type PlayerCoordinate, type PlayerSyncGame, type PlayerTournament } from './playerSync';
import { matchReferenceKey, type MatchCandidate, type MatchDecision, type MatchPreferences, type MatchVariant, type RankedMatchCandidate, type SavedMatchGame } from './orbitMatchTypes';

export type MatchWeights = RankedMatchCandidate['components'];
export const defaultMatchWeights: MatchWeights = { stakes: 30, proximity: 25, variant: 20, availability: 15, venue: 10 };

/** Recognize explicit labels only. An ambiguous Holdem/Omaha name stays unknown. */
export function normalizeMatchGameName(name: string): { variant: MatchVariant | null; bigBlind: number | null } {
  const text = name.toLowerCase().replace(/[’']/g, '');
  const variants: MatchVariant[] = [];
  if (/\bnlh\b|\bno[ -]?limit\s+(?:texas\s+)?hold(?:em| em)\b/.test(text)) variants.push('nlh');
  if (/\bplo\b|\bpot[ -]?limit\s+omaha\b/.test(text) && !/\b(?:hi[ -]?lo|high[ -]?low|omaha[ -]?8|plo[ -]?8|5[ -]?card|five[ -]?card|8[ -]?or[ -]?better)\b/.test(text)) variants.push('plo');
  if (!/\bno[ -]?limit\b/.test(text) && /\blimit\s+hold(?:em| em)\b/.test(text)) variants.push('limit-holdem');
  if (/\bmixed\b|\bdealers? choice\b|\bdc\b|\broe\b|\bround of each\b/.test(text)) variants.push('mixed');
  const pairs = [...text.matchAll(/(?:^|[^\d./$-])\$?(\d+(?:\.\d+)?)\s*\/\s*\$?(\d+(?:\.\d+)?)(?![\d./])/g)];
  const pair = pairs.length === 1 ? pairs[0] : undefined;
  const small = pair ? Number(pair[1]) : NaN;
  const big = pair ? Number(pair[2]) : NaN;
  return { variant: variants.length === 1 ? variants[0] : null, bigBlind: small > 0 && big >= small && big <= 100_000 ? big : null };
}

function tableFacts(game: PlayerSyncGame) {
  const valid = new Set(game.openTables.map((table) => table.id)).size === game.openTables.length
    && game.openTables.every((table) => table.gameId === game.id
    && Number.isInteger(table.maxSeats) && table.maxSeats > 0
    && Number.isInteger(table.seatsFilled) && table.seatsFilled >= 0
    && Number.isInteger(table.availableSeats) && table.availableSeats >= 0
    && table.seatsFilled + table.availableSeats <= table.maxSeats
    && ['Running', 'Forming', 'Paused'].includes(table.status));
  const running = game.openTables.filter((table) => table.status === 'Running');
  const status: MatchCandidate['status'] = !valid ? 'inactive' : running.length ? 'live'
    : game.openTables.some((table) => table.status === 'Forming') ? 'forming'
      : game.openTables.some((table) => table.status === 'Paused') ? 'paused' : 'inactive';
  return { status, availableSeats: valid ? running.reduce((sum, table) => sum + table.availableSeats, 0) : null };
}

export function buildMatchCandidates({ clubs, player, activeGameKeys, nowMs, origin, tournaments = [] }: {
  clubs: PlayerClubSnapshot[];
  player: PlayerAccount;
  activeGameKeys: Set<string>;
  nowMs: number;
  origin: PlayerCoordinate | null;
  tournaments?: PlayerTournament[];
}): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  for (const club of clubs) {
    if (!club.club.id.trim() || !club.club.name.trim()) continue;
    const distanceMiles = getClubDistance(club, origin);
    for (const game of club.games) {
      if (!game.id.trim() || !game.name.trim()) continue;
      const facts = tableFacts(game);
      candidates.push({
        ref: { clubId: club.club.id, gameId: game.id, kind: 'cash' },
        summary: { venueName: club.club.name, gameName: game.name },
        opportunity: { club, game, distanceMiles, isJoined: getPlayerSeatRequestAccess(club, player, nowMs) === 'active', isPreferred: player.preferredGameIds.includes(game.id), seatRequestAccess: getPlayerSeatRequestAccess(club, player, nowMs) },
        tournament: null,
        ...normalizeMatchGameName(game.name),
        buyIn: null,
        distanceMiles,
        ...facts,
        waitlistCount: Number.isInteger(game.waitlistCount) && game.waitlistCount >= 0 ? game.waitlistCount : null,
        publishedAt: game.updatedAt && Number.isFinite(Date.parse(game.updatedAt)) ? game.updatedAt : null,
        activeRequest: activeGameKeys.has(`${club.club.id}:${game.id}`)
      });
    }
    for (const tournament of tournaments.filter((event) => event.clubId === club.club.id)) {
      if (!tournament.id.trim() || !tournament.name.trim()) continue;
      candidates.push({
        ref: { clubId: club.club.id, gameId: tournament.id, kind: 'tournament' },
        summary: { venueName: club.club.name, gameName: tournament.name },
        opportunity: null, tournament,
        ...normalizeMatchGameName(tournament.name),
        buyIn: typeof tournament.buyIn === 'number' && Number.isFinite(tournament.buyIn) && tournament.buyIn >= 0 ? tournament.buyIn : null,
        distanceMiles, status: isUpcomingTournament(tournament, nowMs) ? 'scheduled' : 'inactive',
        availableSeats: null, waitlistCount: null, publishedAt: null, activeRequest: false
      });
    }
  }
  // Public page merges can repeat a record. Keep one canonical reference.
  return [...new Map(candidates.map((candidate) => [matchReferenceKey(candidate.ref), candidate])).values()];
}

export function scoreMatchStakes(bigBlind: number | null, range: MatchPreferences['stakes']) {
  if (bigBlind == null || !range || !(bigBlind > 0)) return 0;
  if (bigBlind >= range.minBigBlind && bigBlind <= range.maxBigBlind) return 1;
  return bigBlind < range.minBigBlind ? bigBlind / range.minBigBlind : range.maxBigBlind / bigBlind;
}
export function scoreMatchBuyIn(buyIn: number | null, range: MatchPreferences['buyIn']) {
  if (buyIn == null || !Number.isFinite(buyIn) || buyIn < 0 || !range) return 0;
  if (buyIn >= range.min && buyIn <= range.max) return 1;
  return buyIn < range.min ? buyIn / range.min : range.max / buyIn;
}
export function scoreMatchProximity(distance: number | null, radius: number | null) {
  const scale = radius ?? 25;
  return distance != null && Number.isFinite(distance) && distance >= 0 && Number.isFinite(scale) && scale > 0 ? 1 / (1 + distance / scale) : 0;
}
export function scoreMatchVariant(variant: MatchVariant | null, variants: MatchVariant[]) {
  return variant != null && variants.includes(variant) ? 1 : 0;
}
export function scoreMatchAvailability(candidate: MatchCandidate) {
  if (candidate.status !== 'live' || candidate.availableSeats == null || candidate.waitlistCount == null) return 0;
  return (candidate.availableSeats > 0 ? 0.7 : 0) + 0.3 / (1 + candidate.waitlistCount);
}
export function scoreMatchVenue(clubId: string, favorites: string[]) { return favorites.includes(clubId) ? 1 : 0; }

function scheduleFormatter(timeZone: string) {
  const options: Intl.DateTimeFormatOptions = { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' };
  try { return new Intl.DateTimeFormat('en-US', options); }
  catch { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }); }
}

/** Only an absolute published event timestamp supplies playing-day/time evidence. */
function schedulePreference(candidate: MatchCandidate, preferences: MatchPreferences, context: { formatter: Intl.DateTimeFormat; timeZone: string } | null) {
  const startsAt = candidate.tournament?.startsAt;
  if (!context || candidate.status !== 'scheduled' || candidate.ref.kind !== 'tournament' || !startsAt
    || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(startsAt) || !Number.isFinite(Date.parse(startsAt))) return { score: 0, reason: null };
  const parts = context.formatter.formatToParts(new Date(startsAt));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((part) => part.type === 'weekday')?.value ?? '');
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (day < 0 || !Number.isInteger(hour) || hour < 0 || hour > 23) return { score: 0, reason: null };
  const hasDay = preferences.preferredDays.length > 0;
  const hasTime = preferences.preferredTime !== 'any';
  const matchesDay = hasDay && preferences.preferredDays.includes(day);
  const matchesTime = hasTime && (preferences.preferredTime === 'day' ? hour >= 6 && hour < 18 : hour >= 18);
  const score = (Number(matchesDay) + Number(matchesTime)) / (Number(hasDay) + Number(hasTime));
  const matched = matchesDay && matchesTime ? 'day and time' : matchesDay ? 'day' : 'time';
  return { score, reason: score > 0 ? `Published start matches your preferred ${matched} (${context.timeZone}).` : null };
}

export function rankMatchCandidates({ candidates, preferences, decisions, weights = {}, limit = 100, timeZone = 'UTC' }: {
  candidates: MatchCandidate[];
  preferences: MatchPreferences;
  decisions: MatchDecision[];
  weights?: Partial<MatchWeights>;
  limit?: number;
  timeZone?: string;
}): RankedMatchCandidate[] {
  const weighting = { ...defaultMatchWeights, ...weights };
  const totalWeight = Object.values(weighting).reduce((sum, weight) => sum + weight, 0);
  if (!Object.values(weighting).every((weight) => Number.isFinite(weight) && weight >= 0) || !Number.isFinite(totalWeight) || totalWeight <= 0) throw new RangeError('Match weights must be finite, nonnegative, and have a positive total.');
  const reviewed = new Set(decisions.map((record) => matchReferenceKey(record.ref)));
  const favorites = new Set(preferences.favoriteClubIds);
  const knownVenues = new Set([...favorites, ...decisions.filter((record) => record.decision === 'saved').map((record) => record.ref.clubId)]);
  const formatter = preferences.preferredDays.length || preferences.preferredTime !== 'any' ? scheduleFormatter(timeZone) : null;
  const scheduleContext = formatter ? { formatter, timeZone: formatter.resolvedOptions().timeZone } : null;
  // Keep exploration inside the normalized venue factor and below five total score points, including custom weights.
  const explorationComponent = weighting.venue > 0 ? Math.min(0.5, 0.05 / (weighting.venue / totalWeight)) : 0;
  const ranked = candidates.filter((candidate) => {
    if (candidate.status === 'inactive' || candidate.status === 'paused' || candidate.activeRequest || reviewed.has(matchReferenceKey(candidate.ref))) return false;
    if (preferences.excludedClubIds.includes(candidate.ref.clubId)) return false;
    if (preferences.format !== 'any' && candidate.ref.kind !== preferences.format) return false;
    if (preferences.maxDistanceMiles != null && (!Number.isFinite(preferences.maxDistanceMiles) || preferences.maxDistanceMiles < 0
      || candidate.distanceMiles == null || !Number.isFinite(candidate.distanceMiles) || candidate.distanceMiles < 0 || candidate.distanceMiles > preferences.maxDistanceMiles)) return false;
    if (preferences.requireSeatsNow && (candidate.status !== 'live' || !candidate.availableSeats)) return false;
    if (!preferences.willingToWait && candidate.ref.kind === 'cash' && (!candidate.availableSeats || candidate.waitlistCount == null || candidate.waitlistCount > 0)) return false;
    if (preferences.maxWaitlist != null && candidate.ref.kind === 'cash' && (candidate.waitlistCount == null || candidate.waitlistCount > preferences.maxWaitlist)) return false;
    if (preferences.strictVariants && preferences.variants.length && (!candidate.variant || !preferences.variants.includes(candidate.variant))) return false;
    if (preferences.strictStakes && preferences.stakes && (candidate.bigBlind == null || candidate.bigBlind < preferences.stakes.minBigBlind || candidate.bigBlind > preferences.stakes.maxBigBlind)) return false;
    if (preferences.strictBuyIn && preferences.buyIn && (candidate.buyIn == null || candidate.buyIn < preferences.buyIn.min || candidate.buyIn > preferences.buyIn.max)) return false;
    return true;
  }).map((candidate): RankedMatchCandidate => {
    const schedule = schedulePreference(candidate, preferences, scheduleContext);
    const explore = preferences.exploreNewVenues && knownVenues.size > 0 && !knownVenues.has(candidate.ref.clubId)
      && Boolean(candidate.ref.clubId.trim() && candidate.summary.venueName.trim());
    const components = {
      stakes: candidate.ref.kind === 'tournament' ? scoreMatchBuyIn(candidate.buyIn, preferences.buyIn) : scoreMatchStakes(candidate.bigBlind, preferences.stakes),
      proximity: scoreMatchProximity(candidate.distanceMiles, preferences.maxDistanceMiles),
      variant: scoreMatchVariant(candidate.variant, preferences.variants),
      availability: candidate.status === 'scheduled' ? schedule.score : scoreMatchAvailability(candidate),
      venue: favorites.has(candidate.ref.clubId) ? 1 : explore ? explorationComponent : 0
    };
    const reasons: Array<{ text: string; strength: number }> = [];
    if (candidate.ref.kind === 'cash' && preferences.stakes && components.stakes === 1) reasons.push({ text: 'Within your preferred stakes range.', strength: weighting.stakes });
    if (candidate.ref.kind === 'tournament' && preferences.buyIn && components.stakes === 1) reasons.push({ text: 'Published buy-in is within your preferred range.', strength: weighting.stakes });
    if (components.variant === 1) reasons.push({ text: 'Matches your preferred game variant.', strength: weighting.variant });
    if (components.venue === 1) reasons.push({ text: 'One of your favorite venues.', strength: weighting.venue });
    else if (explore && components.venue > 0) reasons.push({ text: 'Outside your favorite and currently saved venues.', strength: weighting.venue * components.venue });
    if (schedule.reason) reasons.push({ text: schedule.reason, strength: weighting.availability * schedule.score });
    if (candidate.distanceMiles != null && Number.isFinite(candidate.distanceMiles) && candidate.distanceMiles >= 0) reasons.push({ text: `${candidate.distanceMiles.toFixed(1)} miles from your selected location.`, strength: weighting.proximity * components.proximity });
    if (candidate.status === 'live' && candidate.availableSeats != null && candidate.availableSeats > 0) reasons.push({ text: `${candidate.availableSeats} published open seat${candidate.availableSeats === 1 ? '' : 's'}.`, strength: weighting.availability * components.availability });
    const score = (Object.keys(components) as Array<keyof MatchWeights>).reduce((sum, key) => sum + components[key] * weighting[key], 0) / totalWeight * 100;
    return { ...candidate, components, score, reasons: reasons.sort((left, right) => right.strength - left.strength).slice(0, 2).map((reason) => reason.text) };
  }).sort((left, right) => right.score - left.score || matchReferenceKey(left.ref).localeCompare(matchReferenceKey(right.ref)));
  // Diversity only reorders already eligible, similarly ranked records.
  const diversified: RankedMatchCandidate[] = [];
  while (ranked.length && diversified.length < Math.max(0, Math.min(500, Math.floor(limit)))) {
    const previous = diversified.at(-1);
    const alternative = previous ? ranked.findIndex((candidate) => candidate.ref.clubId !== previous.ref.clubId && candidate.score >= ranked[0].score - 5) : -1;
    diversified.push(...ranked.splice(alternative >= 0 ? alternative : 0, 1));
  }
  return diversified;
}

export function resolveSavedMatchGames({ candidates, decisions, catalogComplete, catalogCompleteByKind }: {
  candidates: MatchCandidate[];
  decisions: MatchDecision[];
  catalogComplete: boolean;
  catalogCompleteByKind?: Record<MatchCandidate['ref']['kind'], boolean>;
}): SavedMatchGame[] {
  const byKey = new Map(candidates.map((candidate) => [matchReferenceKey(candidate.ref), candidate]));
  return decisions.filter((record) => record.decision === 'saved').map((record) => {
    const candidate = byKey.get(matchReferenceKey(record.ref)) ?? null;
    return { record, candidate, unavailableReason: candidate
      ? candidate.status === 'inactive' ? 'This game has no active published table or upcoming event.' : null
      : (catalogCompleteByKind?.[record.ref.kind] ?? catalogComplete) ? 'This game is no longer in the published catalog.' : 'This game has not loaded. Refresh venue data to check availability.' };
  });
}
