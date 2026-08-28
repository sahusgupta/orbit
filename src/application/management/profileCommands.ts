import { createMembershipWindow, parseMembershipPrice } from '../../lib/membership';
import {
  findUniqueProfileReference,
  getProfileReferenceMatches
} from '../../lib/profileRelationships';
import { inactiveInterestStatuses } from '../../domain/participants';
import type { AppState, PlayerProfile, TableTag } from '../../domain/types';
import { ensureWaitlistInterest } from './waitlistCommands';

export type ProfileIdentityDependencies = {
  createProfileId: () => string;
};

export type ProfileClockDependencies = {
  todayDate: () => string;
  nextYearDate: () => string;
};

export type ProfileCommandDependencies = ProfileIdentityDependencies & {
  createId: () => string;
  nowDate: () => Date;
  nowIso: () => string;
};

export type NewActiveProfileInput = {
  name: string;
  email?: string;
  phone: string;
  address?: string;
  birthday: string;
  membershipPlan: 'day' | 'monthly';
  membershipAmount: number;
  totalTimePlayedHours: number;
  lastSessionTimePlayedHours: number;
  commonlyPlaysWithProfileIds: string[];
  preferredGameId: string;
  preferredGameIds: string[];
  preferredStakes: string;
  typicalBuyInMin: number;
  typicalBuyInMax: number;
  willingnessToMove: boolean;
  typicalAvailability: string;
  preferredTags: TableTag[];
  usualCompanions: string;
  notes: string;
  identityCaptureMethod?: 'id-barcode' | 'player-camera-pdf417';
};

export type ProfileValidationFailure = {
  ok: false;
  code: 'missing-name' | 'duplicate-name';
  message: string;
  profileName: string;
};

type ArchivablePlayerProfile = PlayerProfile & {
  archivedAt?: string;
  archivedReason?: string;
};

export function buildPlayerProfile(
  state: AppState,
  name: string,
  gameId: string,
  patch: Partial<PlayerProfile>,
  dependencies: ProfileIdentityDependencies & ProfileClockDependencies
): PlayerProfile {
  const preferredGame = state.games.find((game) => game.id === gameId) ?? state.games[0];
  const preferredGameId = preferredGame?.id ?? gameId ?? 'nlh-1-2';
  return {
    id: patch.id ?? dependencies.createProfileId(),
    name: name.trim(),
    email: patch.email?.trim().toLowerCase() || undefined,
    phone: patch.phone ?? '',
    address: patch.address ?? '',
    birthday: patch.birthday ?? '',
    membershipStartDate: patch.membershipStartDate ?? dependencies.todayDate(),
    membershipExpirationDate: patch.membershipExpirationDate ?? dependencies.nextYearDate(),
    totalTimePlayedHours: patch.totalTimePlayedHours ?? 0,
    lastSessionTimePlayedHours: patch.lastSessionTimePlayedHours ?? 0,
    commonlyPlaysWithProfileIds: patch.commonlyPlaysWithProfileIds ?? [],
    preferredGameId: patch.preferredGameId ?? preferredGameId,
    preferredGameIds: patch.preferredGameIds?.length ? patch.preferredGameIds : [preferredGameId],
    gamePlayCounts: patch.gamePlayCounts ?? {},
    mostPlayedGameId: patch.mostPlayedGameId ?? preferredGameId,
    preferredStakes: patch.preferredStakes ?? preferredGame?.name ?? '',
    typicalBuyInMin: patch.typicalBuyInMin ?? 200,
    typicalBuyInMax: patch.typicalBuyInMax ?? 500,
    willingnessToMove: patch.willingnessToMove ?? true,
    typicalAvailability: patch.typicalAvailability ?? '',
    usualCompanions: patch.usualCompanions ?? [],
    preferredTags: patch.preferredTags ?? [],
    notes: patch.notes ?? ''
  };
}

export function saveEditedProfile(
  state: AppState,
  draft: PlayerProfile
): ProfileValidationFailure | { ok: true; state: AppState; profile: PlayerProfile; message: string } {
  const profileName = draft.name.trim();
  if (!profileName) {
    return {
      ok: false,
      code: 'missing-name',
      message: 'Enter a player name before saving the profile.',
      profileName
    };
  }
  const duplicate = state.profiles.find(
    (profile) => profile.id !== draft.id && profile.name.trim().toLowerCase() === profileName.toLowerCase()
  );
  if (duplicate) {
    return {
      ok: false,
      code: 'duplicate-name',
      message: `${profileName} already has a profile.`,
      profileName
    };
  }
  const preferredGameIds = draft.preferredGameIds?.length
    ? draft.preferredGameIds
    : [draft.preferredGameId || state.games[0]?.id || 'nlh-1-2'];
  const profile: PlayerProfile = {
    ...draft,
    name: profileName,
    phone: draft.phone.trim(),
    address: draft.address?.trim() ?? '',
    membershipStartDate: draft.membershipStartDate,
    membershipExpirationDate: draft.membershipExpirationDate,
    preferredGameId: draft.preferredGameId || preferredGameIds[0],
    preferredGameIds,
    preferredStakes: draft.preferredStakes.trim(),
    typicalAvailability: draft.typicalAvailability.trim(),
    notes: draft.notes.trim()
  };
  return {
    ok: true,
    profile,
    message: `${profile.name} profile updated.`,
    state: {
      ...state,
      profiles: state.profiles.map((candidate) => candidate.id === profile.id ? profile : candidate),
      interests: state.interests.map((interest) =>
        interest.profileId === profile.id ? { ...interest, playerName: profile.name } : interest
      ),
      playerSessions: state.playerSessions.map((session) =>
        session.profileId === profile.id ? { ...session, playerName: profile.name } : session
      ),
      buyIns: state.buyIns.map((buyIn) =>
        buyIn.profileId === profile.id ? { ...buyIn, playerName: profile.name } : buyIn
      ),
      playerLedger: state.playerLedger.map((entry) =>
        entry.profileId === profile.id ? { ...entry, playerName: profile.name } : entry
      )
    }
  };
}

export function createActiveMemberProfile(
  state: AppState,
  input: NewActiveProfileInput,
  dependencies: ProfileCommandDependencies
): ProfileValidationFailure | { ok: true; state: AppState; profile: PlayerProfile; message: string } {
  const profileName = input.name.trim();
  if (!profileName) {
    return {
      ok: false,
      code: 'missing-name',
      message: 'Enter a player name before adding the profile.',
      profileName
    };
  }
  const duplicate = state.profiles.find(
    (profile) => profile.name.trim().toLowerCase() === profileName.toLowerCase()
  );
  if (duplicate) {
    return {
      ok: false,
      code: 'duplicate-name',
      message: `${profileName} already has a profile.`,
      profileName
    };
  }
  const preferredGame = state.games.find((game) => game.id === input.preferredGameId);
  const membership = createMembershipWindow(input.membershipPlan, dependencies.nowDate());
  const membershipAmount = parseMembershipPrice(input.membershipAmount);
  const profile: PlayerProfile = {
    id: dependencies.createProfileId(),
    name: profileName,
    email: input.email?.trim().toLowerCase() || undefined,
    phone: input.phone.trim(),
    address: input.address?.trim() ?? '',
    birthday: input.birthday,
    membershipStartDate: membership.startDate,
    membershipExpirationDate: membership.expirationDate,
    membershipExpiresAt: membership.expiresAt.toISOString(),
    membershipPlan: input.membershipPlan,
    membershipPaymentMethod: 'core',
    membershipStatus: 'Active',
    membershipRequestedAt: membership.startedAt.toISOString(),
    membershipPriceLabel: membershipAmount ? `$${membershipAmount.toFixed(2)}` : undefined,
    membershipPaymentStatus: membershipAmount > 0 ? 'Paid' : 'Not required',
    membershipPaymentAmountCents: Math.round(membershipAmount * 100),
    totalTimePlayedHours: input.totalTimePlayedHours,
    lastSessionTimePlayedHours: input.lastSessionTimePlayedHours,
    commonlyPlaysWithProfileIds: input.commonlyPlaysWithProfileIds,
    preferredGameId: input.preferredGameId,
    preferredGameIds: [input.preferredGameId],
    gamePlayCounts: {},
    mostPlayedGameId: input.preferredGameId,
    preferredStakes: input.preferredStakes.trim() || preferredGame?.name || '',
    typicalBuyInMin: input.typicalBuyInMin,
    typicalBuyInMax: input.typicalBuyInMax,
    willingnessToMove: input.willingnessToMove,
    typicalAvailability: input.typicalAvailability.trim(),
    preferredTags: input.preferredTags,
    usualCompanions: input.usualCompanions.split(',').map((name) => name.trim()).filter(Boolean),
    notes: input.notes.trim(),
    identityCaptureMethod: input.identityCaptureMethod,
    identityCapturedAt: input.identityCaptureMethod ? dependencies.nowIso() : undefined,
    identityReviewStatus: input.identityCaptureMethod === 'player-camera-pdf417' ? 'Pending' : input.identityCaptureMethod === 'id-barcode' ? 'Approved' : 'Not required',
    identityReviewedAt: input.identityCaptureMethod === 'id-barcode' ? dependencies.nowIso() : undefined
  };
  return {
    ok: true,
    profile,
    message: `${profileName} profile added.`,
    state: {
      ...state,
      profiles: [...state.profiles, profile],
      revenueTransactions: membershipAmount > 0
        ? [
            ...state.revenueTransactions,
            {
              id: dependencies.createId(),
              type: 'membership',
              amountCents: Math.round(membershipAmount * 100),
              occurredAt: membership.startedAt.toISOString(),
              paymentStatus: 'paid',
              source: 'manual',
              playerId: profile.id,
              playerName: profileName,
              membershipPlan: input.membershipPlan
            }
          ]
        : state.revenueTransactions
    }
  };
}

export function archiveProfile(
  state: AppState,
  profileId: string,
  archivedAt: string,
  archivedReason?: string
): AppState {
  const profile = state.profiles.find((candidate) => candidate.id === profileId) as ArchivablePlayerProfile | undefined;
  if (!profile || profile.archivedAt) return state;
  const normalizedReason = archivedReason?.trim();
  return {
    ...state,
    profiles: state.profiles.map((candidate) =>
      candidate.id === profileId
        ? {
            ...candidate,
            archivedAt,
            archivedReason: normalizedReason || undefined
          }
        : candidate
    )
  };
}

export function restoreProfile(state: AppState, profileId: string): AppState {
  const profile = state.profiles.find((candidate) => candidate.id === profileId) as ArchivablePlayerProfile | undefined;
  if (!profile?.archivedAt) return state;
  return {
    ...state,
    profiles: state.profiles.map((candidate) => {
      if (candidate.id !== profileId) return candidate;
      const {
        archivedAt: _archivedAt,
        archivedReason: _archivedReason,
        ...restored
      } = candidate as ArchivablePlayerProfile;
      return restored;
    })
  };
}

export function deleteProfile(state: AppState, profileId: string): AppState {
  return {
    ...state,
    profiles: state.profiles.filter((profile) => profile.id !== profileId),
    interests: state.interests.map((interest) =>
      interest.profileId === profileId ? { ...interest, profileId: undefined } : interest
    )
  };
}

export function mergeDuplicateProfiles(state: AppState, profilesToMerge: PlayerProfile[]): AppState {
  const [primary, ...duplicates] = profilesToMerge;
  if (!primary) return state;
  const duplicateIds = new Set(duplicates.map((profile) => profile.id));
  const gamePlayCounts = profilesToMerge.reduce<Record<string, number>>((counts, profile) => {
    Object.entries(profile.gamePlayCounts ?? {}).forEach(([gameId, count]) => {
      counts[gameId] = (counts[gameId] ?? 0) + count;
    });
    return counts;
  }, {});
  const getGameName = (gameId: string) =>
    state.games.find((game) => game.id === gameId)?.name ?? gameId ?? 'Unknown game';
  const mostPlayedGameId = Object.entries(gamePlayCounts)
    .sort((left, right) => right[1] - left[1] || getGameName(left[0]).localeCompare(getGameName(right[0])))[0]?.[0]
    ?? primary.mostPlayedGameId
    ?? primary.preferredGameId;
  const merged: PlayerProfile = {
    ...primary,
    birthday: primary.birthday || profilesToMerge.find((profile) => profile.birthday)?.birthday || '',
    membershipStartDate: profilesToMerge.map((profile) => profile.membershipStartDate).filter(Boolean).sort()[0]
      ?? primary.membershipStartDate,
    membershipExpirationDate: profilesToMerge.map((profile) => profile.membershipExpirationDate).filter(Boolean).sort().at(-1)
      ?? primary.membershipExpirationDate,
    totalTimePlayedHours: profilesToMerge.reduce((sum, profile) => sum + (profile.totalTimePlayedHours ?? 0), 0),
    lastSessionTimePlayedHours: Math.max(...profilesToMerge.map((profile) => profile.lastSessionTimePlayedHours ?? 0)),
    commonlyPlaysWithProfileIds: Array.from(new Set(
      profilesToMerge.flatMap((profile) => profile.commonlyPlaysWithProfileIds ?? [])
        .filter((id) => id !== primary.id && !duplicateIds.has(id))
    )),
    preferredGameId: primary.preferredGameId
      || profilesToMerge.find((profile) => profile.preferredGameId)?.preferredGameId
      || primary.preferredGameIds[0],
    preferredGameIds: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.preferredGameIds))),
    gamePlayCounts,
    mostPlayedGameId,
    preferredStakes: Array.from(new Set(
      profilesToMerge.flatMap((profile) => profile.preferredStakes.split(',').map((item) => item.trim()).filter(Boolean))
    )).join(', '),
    typicalBuyInMin: Math.min(...profilesToMerge.map((profile) => profile.typicalBuyInMin || primary.typicalBuyInMin)),
    typicalBuyInMax: Math.max(...profilesToMerge.map((profile) => profile.typicalBuyInMax || primary.typicalBuyInMax)),
    willingnessToMove: profilesToMerge.some((profile) => profile.willingnessToMove),
    typicalAvailability: Array.from(new Set(profilesToMerge.map((profile) => profile.typicalAvailability).filter(Boolean))).join(', '),
    usualCompanions: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.usualCompanions))),
    preferredTags: Array.from(new Set(profilesToMerge.flatMap((profile) => profile.preferredTags))),
    notes: Array.from(new Set(profilesToMerge.map((profile) => profile.notes).filter(Boolean))).join(' | ')
  };
  return {
    ...state,
    profiles: state.profiles.map((profile) => profile.id === primary.id ? merged : profile)
      .filter((profile) => !duplicateIds.has(profile.id)),
    interests: state.interests.map((interest) =>
      interest.profileId && duplicateIds.has(interest.profileId) ? { ...interest, profileId: primary.id } : interest
    ),
    playerSessions: state.playerSessions.map((session) =>
      session.profileId && duplicateIds.has(session.profileId) ? { ...session, profileId: primary.id } : session
    )
  };
}

export function checkProfileIntoClub(
  state: AppState,
  profile: PlayerProfile,
  dependencies: Pick<ProfileCommandDependencies, 'createId' | 'nowIso'>
) {
  const existingInterest = findUniqueProfileReference(
    state.interests,
    state.profiles,
    profile,
    (interest) => !inactiveInterestStatuses.includes(interest.status)
  );
  const preferredGameId = profile.preferredGameIds[0] ?? state.games[0]?.id ?? 'nlh-1-2';
  const gameId = existingInterest?.gameId || preferredGameId;
  const timestamp = dependencies.nowIso();
  return {
    preferredGameId,
    state: {
      ...state,
      interests: ensureWaitlistInterest(
        state,
        profile,
        gameId,
        'Arrived',
        'Checked in at club entry',
        timestamp,
        dependencies.createId
      ),
      playerLedger: [
        {
          id: dependencies.createId(),
          type: 'Check-In' as const,
          profileId: profile.id,
          playerName: profile.name,
          gameId,
          timestamp,
          note: 'Checked in at club entry'
        },
        ...state.playerLedger
      ]
    }
  };
}

export function removeProfileFromClub(
  state: AppState,
  profile: PlayerProfile,
  dependencies: Pick<ProfileCommandDependencies, 'nowIso'>
): AppState {
  const matchingInterestIds = new Set(
    getProfileReferenceMatches(
      state.interests,
      state.profiles,
      profile,
      (interest) => interest.status === 'Arrived' || interest.status === 'Seated'
    ).map((interest) => interest.id)
  );
  if (matchingInterestIds.size === 0) return state;

  const timestamp = dependencies.nowIso();
  return {
    ...state,
    interests: state.interests.map((interest) =>
      matchingInterestIds.has(interest.id)
        ? { ...interest, status: 'Removed', closedAt: timestamp, timestamp }
        : interest
    )
  };
}
