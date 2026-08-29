import type { GameConfig, PlayerProfile, TableTag } from './types';

export type ProfileImportContext = {
  games: GameConfig[];
  createProfileId: () => string;
  todayDate: () => string;
  nextYearDate: () => string;
  resolveGameId: (games: GameConfig[], value?: string, fallbackId?: string) => string;
  validTableTags: readonly TableTag[];
};

const importedValue = (item: Record<string, unknown>, aliases: string[]) => {
  const normalizedAliases = new Set(aliases.map((alias) => alias.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const match = Object.entries(item).find(([key]) => normalizedAliases.has(key.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return match?.[1];
};

const importedString = (item: Record<string, unknown>, aliases: string[], fallback = '') => {
  const value = importedValue(item, aliases);
  return value === undefined || value === null ? fallback : String(value).trim();
};

const importedDate = (item: Record<string, unknown>, aliases: string[], fallback: string) => {
  const value = importedValue(item, aliases);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && Number.isFinite(value)) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return new Date(excelEpoch + value * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (!text) return fallback;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return text.slice(0, 10);
};

const importedNumber = (item: Record<string, unknown>, aliases: string[], fallback = 0) => {
  const value = Number(importedValue(item, aliases) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
};

const importedHoursAndMinutes = (
  item: Record<string, unknown>,
  hourAliases: string[],
  minuteAliases: string[]
) => importedNumber(item, hourAliases) + importedNumber(item, minuteAliases) / 60;

const importedBoolean = (item: Record<string, unknown>, aliases: string[], fallback = false) => {
  const value = importedValue(item, aliases);
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return /^(true|t|yes|y|1)(?:\b|[^a-z0-9])/i.test(String(value).trim());
};

const importedPhone = (item: Record<string, unknown>) => {
  const value = importedString(item, ['phone', 'Phone', 'phoneNumber', 'Phone Number', 'mobile', 'Mobile', 'cell', 'Cell']);
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return '';
};

const importedEmail = (item: Record<string, unknown>) => {
  const value = importedString(item, ['email', 'Email', 'emailAddress', 'Email Address']);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : '';
};

const isImportedObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isImportedJsonProfile = (value: unknown): value is Record<string, unknown> =>
  isImportedObject(value) && typeof value.name === 'string' && Boolean(value.name.trim());

const importedJsonNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const importedJsonStringArray = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const isTableTag = (value: unknown, validTableTags: readonly TableTag[]): value is TableTag =>
  typeof value === 'string' && validTableTags.some((tag) => tag === value);

export function profileFromImportedRecord(
  item: Record<string, unknown>,
  context: ProfileImportContext
): PlayerProfile {
  const firstName = importedString(item, ['firstName', 'First Name', 'first']);
  const lastName = importedString(item, ['lastName', 'Last Name', 'last']);
  const fullName = importedString(item, ['name', 'Name', 'playerName', 'Player Name', 'player', 'Player', 'customerName', 'Customer Name']);
  const name = fullName || [firstName, lastName].filter(Boolean).join(' ');
  const preferredStakes = importedString(item, ['preferredStakes', 'Preferred Stakes', 'preferredGame', 'Preferred Game', 'stakes', 'Game']);
  const preferredGameId = context.resolveGameId(
    context.games,
    importedString(item, ['preferredGameId', 'Preferred Game Id', 'preferredGame', 'Preferred Game', 'stakes', 'Game'], preferredStakes),
    context.resolveGameId(context.games, preferredStakes, context.games[0]?.id ?? '')
  );
  const companionNames = importedString(item, ['usualCompanions', 'companions', 'Companions', 'commonlyPlaysWith', 'Commonly Plays With'])
    .split(/[|;]/)
    .map((companionName) => companionName.trim())
    .filter(Boolean);
  const email = importedEmail(item);
  const addressParts = {
    street: importedString(item, ['address.street', 'Address Street', 'street', 'Street']),
    city: importedString(item, ['address.city', 'Address City', 'city', 'City']),
    state: importedString(item, ['address.state', 'Address State', 'state', 'State']),
    zipCode: importedString(item, ['address.zipCode', 'Address Zip Code', 'zipCode', 'Zip Code', 'zip', 'ZIP'])
  };
  const address = importedString(item, ['address', 'Address', 'fullAddress', 'Full Address']) || [
    addressParts.street,
    addressParts.city,
    [addressParts.state, addressParts.zipCode].filter(Boolean).join(' ')
  ].filter(Boolean).join(', ');
  const preferenceAliases = [
    'optInEmail', 'Opt In Email', 'emailOptIn', 'Email Opt In',
    'optInMail', 'Opt In Mail', 'mailOptIn', 'Mail Opt In',
    'optInSMS', 'Opt In SMS', 'smsOptIn', 'SMS Opt In'
  ];
  const hasCommunicationPreferences = preferenceAliases.some((alias) => importedValue(item, [alias]) !== undefined);
  return {
    id: importedString(item, ['id', 'ID', 'memberId', 'Member ID', 'membershipId', 'Membership ID', 'playerId', 'Player ID', 'playerNumber', 'Player Number', 'cardNumber', 'Card Number', 'cardId', 'Card ID'], context.createProfileId()),
    name,
    phone: importedPhone(item),
    ...(email ? { email } : {}),
    ...(address ? { address } : {}),
    ...(hasCommunicationPreferences ? {
      communicationPreferences: {
        email: importedBoolean(item, ['optInEmail', 'Opt In Email', 'emailOptIn', 'Email Opt In']),
        mail: importedBoolean(item, ['optInMail', 'Opt In Mail', 'mailOptIn', 'Mail Opt In']),
        sms: importedBoolean(item, ['optInSMS', 'Opt In SMS', 'smsOptIn', 'SMS Opt In'])
      }
    } : {}),
    birthday: importedDate(item, ['birthday', 'Birthday', 'dob', 'DOB', 'dateOfBirth', 'Date of Birth'], ''),
    membershipStartDate: importedDate(item, ['membershipStartDate', 'Membership Start', 'memberSince', 'Member Since', 'joinDate', 'Join Date', 'createdAt', 'Created At', 'createdDate', 'Created Date'], context.todayDate()),
    membershipExpirationDate: importedDate(item, ['membershipExpirationDate', 'Membership Expiration', 'expiresAt', 'Expires At', 'expirationDate', 'Expiration Date', 'expiryDate', 'Expiry Date'], context.nextYearDate()),
    totalTimePlayedHours: importedHoursAndMinutes(item, ['totalTimePlayedHours', 'totalTimePlayed', 'Total Time Played', 'lifetimeHours', 'Lifetime Hours', 'totalHours', 'Total Hours'], ['totalMinutes', 'Total Minutes']),
    lastSessionTimePlayedHours: importedHoursAndMinutes(item, ['lastSessionTimePlayedHours', 'lastSessionTimePlayed', 'Last Session Time Played', 'joinHours', 'Join Hours'], ['joinMinutes', 'Join Minutes']),
    commonlyPlaysWithProfileIds: [],
    preferredGameId,
    preferredGameIds: preferredGameId ? [preferredGameId] : [],
    gamePlayCounts: {},
    mostPlayedGameId: preferredGameId,
    preferredStakes,
    typicalBuyInMin: importedNumber(item, ['typicalBuyInMin', 'buyInMin', 'Buy In Min']),
    typicalBuyInMax: importedNumber(item, ['typicalBuyInMax', 'buyInMax', 'Buy In Max']),
    willingnessToMove: ['yes', 'true', 'y', '1'].includes(importedString(item, ['willingnessToMove', 'moveTables', 'Move Tables']).toLowerCase()),
    typicalAvailability: importedString(item, ['typicalAvailability', 'availability', 'Availability']),
    preferredTags: Array.isArray(item.preferredTags)
      ? item.preferredTags.filter((tag): tag is TableTag => isTableTag(tag, context.validTableTags))
      : [],
    usualCompanions: companionNames,
    notes: importedString(item, ['notes', 'Notes', 'note', 'Note'])
  };
}

export function parseCsvRows(text: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  const parseLine = (line: string) => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        index += 1;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        continue;
      }
      if (char === ',' && !quoted) {
        cells.push(cell.trim());
        cell = '';
        continue;
      }
      cell += char;
    }

    cells.push(cell.trim());
    return cells;
  };

  const [headerLine, ...dataLines] = lines;
  const headers = parseLine(headerLine);
  return dataLines.map((line) => {
    const values = parseLine(line);
    return headers.reduce<Record<string, unknown>>((record, header, index) => {
      if (header) record[header] = values[index] ?? '';
      return record;
    }, {});
  });
}

export function profilesFromImportedRecords(
  records: Record<string, unknown>[],
  context: ProfileImportContext
) {
  return records
    .map((record) => profileFromImportedRecord(record, context))
    .filter((profile) => Boolean(profile.name));
}

export function profileFromPastedJsonRecord(
  item: Record<string, unknown>,
  context: ProfileImportContext
): PlayerProfile {
  const rawPreferredGameIds = importedJsonStringArray(item.preferredGameIds);
  const preferredGameId = context.resolveGameId(
    context.games,
    String(item.preferredGameId ?? rawPreferredGameIds[0] ?? item.preferredGame ?? item.stakes ?? ''),
    context.games[0]?.id ?? 'nlh-1-2'
  );
  const companionNames = Array.isArray(item.usualCompanions)
    ? importedJsonStringArray(item.usualCompanions)
    : String(item.usualCompanions ?? item.commonlyPlaysWith ?? item.companions ?? '')
        .split(/[|;]/)
        .map((companionName) => companionName.trim())
        .filter(Boolean);
  const preferredGameIds = rawPreferredGameIds
    .map((gameId) => context.resolveGameId(context.games, gameId, ''))
    .filter((gameId): gameId is string => Boolean(gameId));
  const gamePlayCountsSource = isImportedObject(item.gamePlayCounts) ? item.gamePlayCounts : {};

  return {
    id: String(item.id ?? context.createProfileId()),
    name: String(item.name).trim(),
    phone: String(item.phone ?? item.phoneNumber ?? item.mobile ?? item.cell ?? ''),
    birthday: String(item.birthday ?? ''),
    membershipStartDate: String(item.membershipStartDate ?? item.memberSince ?? context.todayDate()),
    membershipExpirationDate: String(item.membershipExpirationDate ?? item.expiresAt ?? context.nextYearDate()),
    totalTimePlayedHours: importedJsonNumber(item.totalTimePlayedHours ?? item.totalTimePlayed),
    lastSessionTimePlayedHours: importedJsonNumber(item.lastSessionTimePlayedHours ?? item.lastSessionTimePlayed),
    commonlyPlaysWithProfileIds: importedJsonStringArray(item.commonlyPlaysWithProfileIds),
    preferredGameId,
    preferredGameIds: preferredGameIds.length ? Array.from(new Set(preferredGameIds)) : [preferredGameId],
    gamePlayCounts: Object.entries(gamePlayCountsSource).reduce<Record<string, number>>((counts, [gameId, count]) => {
      const resolvedGameId = context.resolveGameId(context.games, gameId, '');
      const numericCount = Number(count);
      if (resolvedGameId && Number.isFinite(numericCount) && numericCount > 0) counts[resolvedGameId] = numericCount;
      return counts;
    }, {}),
    mostPlayedGameId: context.resolveGameId(context.games, String(item.mostPlayedGameId ?? ''), preferredGameId),
    preferredStakes: String(item.preferredStakes ?? item.stakes ?? context.games.find((game) => game.id === preferredGameId)?.name ?? ''),
    typicalBuyInMin: importedJsonNumber(item.typicalBuyInMin ?? item.buyInMin),
    typicalBuyInMax: importedJsonNumber(item.typicalBuyInMax ?? item.buyInMax),
    willingnessToMove: Boolean(item.willingnessToMove ?? item.moveTables ?? false),
    typicalAvailability: String(item.typicalAvailability ?? item.availability ?? ''),
    preferredTags: Array.isArray(item.preferredTags)
      ? item.preferredTags.filter((tag): tag is TableTag => isTableTag(tag, context.validTableTags))
      : [],
    usualCompanions: companionNames,
    notes: String(item.notes ?? '')
  };
}

export function parsePastedProfiles(rawInput: string, context: ProfileImportContext): PlayerProfile[] {
  const raw = rawInput.trim();
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isImportedJsonProfile).map((item) => profileFromPastedJsonRecord(item, context))
      : [];
  } catch {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [
          name,
          preferredStakes = '',
          birthday = '',
          membershipStart = context.todayDate(),
          membershipExpiration = context.nextYearDate(),
          companions = '',
          availability = '',
          moveTables = 'yes'
        ] = line.split(',').map((part) => part.trim());
        const preferredGameId = context.resolveGameId(
          context.games,
          preferredStakes,
          context.games[0]?.id ?? 'nlh-1-2'
        );
        return {
          id: context.createProfileId(),
          name,
          phone: '',
          birthday,
          membershipStartDate: membershipStart || context.todayDate(),
          membershipExpirationDate: membershipExpiration || context.nextYearDate(),
          totalTimePlayedHours: 0,
          lastSessionTimePlayedHours: 0,
          commonlyPlaysWithProfileIds: [],
          preferredGameId,
          preferredGameIds: [preferredGameId],
          gamePlayCounts: {},
          mostPlayedGameId: preferredGameId,
          preferredStakes,
          typicalBuyInMin: 0,
          typicalBuyInMax: 0,
          willingnessToMove: !['no', 'false', 'n'].includes(moveTables.toLowerCase()),
          typicalAvailability: availability,
          preferredTags: [],
          usualCompanions: companions
            .split(/[|;]/)
            .map((companion) => companion.trim())
            .filter(Boolean),
          notes: ''
        };
      })
      .filter((profile) => Boolean(profile.name));
  }
}

export function mergeImportedProfiles(existingProfiles: PlayerProfile[], importedProfiles: PlayerProfile[]) {
  const existingNames = new Set(existingProfiles.map((profile) => profile.name.toLowerCase()));
  const uniqueImports = importedProfiles.filter((profile) => !existingNames.has(profile.name.toLowerCase()));
  const allProfiles = [...existingProfiles, ...uniqueImports];
  const enrichedImports = uniqueImports.map((profile) => ({
    ...profile,
    commonlyPlaysWithProfileIds: profile.commonlyPlaysWithProfileIds.length
      ? profile.commonlyPlaysWithProfileIds
      : profile.usualCompanions
          .map((companionName) => allProfiles.find((candidate) => candidate.name.toLowerCase() === companionName.toLowerCase())?.id)
          .filter((id): id is string => Boolean(id))
  }));
  return {
    profiles: [...existingProfiles, ...enrichedImports],
    importedProfiles: enrichedImports
  };
}
