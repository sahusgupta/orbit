import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedButton, AnimatedSurface, IconActionButton } from '../../components/PlayerPresentation';
import {
  getPlayerGameStatusLabel,
  getWaitlistAheadText,
  isPlayerWaitlistEntry,
  type PlayerAccount,
  type PlayerClubSnapshot,
  type PlayerSyncGame,
  type PlayerWaitlistEntry
} from '../../domain/playerSync';
import {
  getClubCity,
  getOpportunityTableLabel,
  getRecommendationReason,
  groupOpportunitiesByClub
} from '../../domain/discovery';
import { getAccessProfileText, getClubFeeProfile } from '../../domain/clubAccess';
import type { GameOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function OpportunitySectionList({
  opportunities,
  premium,
  player,
  favoriteClubIds,
  onSelectClub,
  onDirections,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub,
  onToggleFavorite
}: {
  opportunities: GameOpportunity[];
  premium: boolean;
  player: PlayerAccount;
  favoriteClubIds: string[];
  onSelectClub: (item: GameOpportunity) => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onWaitlist: (club: PlayerClubSnapshot, game: PlayerSyncGame) => void;
  onCancelWaitlist: (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => void;
  onJoinClub: (club: PlayerClubSnapshot) => void;
  onToggleFavorite: (club: PlayerClubSnapshot) => void;
}) {
  const sections = groupOpportunitiesByClub(opportunities);
  return (
    <>
      {sections.map((section) => {
        const totalOpenSeats = section.items.reduce((sum, item) => sum + item.game.availableSeats, 0);
        const totalWaiting = section.items.reduce((sum, item) => sum + item.game.waitlistCount, 0);
        const isFavorite = favoriteClubIds.includes(section.club.club.id);
        return (
          <View key={section.club.club.id} style={styles.clubFolder}>
            <View style={styles.clubFolderHeader}>
              <View style={styles.clubFolderAvatar}>
                <Text style={styles.clubFolderAvatarText}>{section.club.club.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.clubFolderCopy}>
                <View style={styles.clubFolderTitleRow}>
                  <Text style={styles.cardTitle}>{section.club.club.name}</Text>
                  {isFavorite ? (
                    <View style={styles.favoriteBadge}>
                      <Ionicons name="star" size={12} color={colors.amber} />
                      <Text style={styles.favoriteBadgeText}>Favorite</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.muted}>
                  {getClubCity(section.club)} / {section.items.length} games / {totalOpenSeats} open seats / {totalWaiting} waiting / {section.distanceMiles.toFixed(1)} mi
                </Text>
              </View>
              <IconActionButton
                icon={isFavorite ? 'star' : 'star-outline'}
                label={isFavorite ? `Unfavorite ${section.club.club.name}` : `Favorite ${section.club.club.name}`}
                onPress={() => onToggleFavorite(section.club)}
                active={isFavorite}
              />
            </View>
            <View style={styles.clubFolderGames}>
              {section.items.map((item, index) => (
                <OpportunityCard
                  key={`${item.club.club.id}:${item.game.id}:${index}`}
                  item={item}
                  tableLabel={getOpportunityTableLabel(item, index)}
                  premium={premium}
                  waitlistEntry={item.club.waitlists.find((entry) => isPlayerWaitlistEntry(entry, player) && entry.gameId === item.game.id)}
                  onSelectClub={() => onSelectClub(item)}
                  onDirections={() => onDirections(item.club)}
                  onWaitlist={() => onWaitlist(item.club, item.game)}
                  onCancelWaitlist={() => {
                    const entry = item.club.waitlists.find((candidate) => isPlayerWaitlistEntry(candidate, player) && candidate.gameId === item.game.id);
                    if (entry) onCancelWaitlist(item.club, item.game, entry);
                  }}
                  onJoinClub={() => onJoinClub(item.club)}
                />
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

export function OpportunityCard({
  item,
  tableLabel,
  premium,
  waitlistEntry,
  onSelectClub,
  onDirections,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub
}: {
  item: GameOpportunity;
  tableLabel?: string;
  premium: boolean;
  waitlistEntry?: PlayerWaitlistEntry;
  onSelectClub: () => void;
  onDirections: () => void;
  onWaitlist: () => void;
  onCancelWaitlist: () => void;
  onJoinClub: () => void;
}) {
  const hasOpenTable = (item.game.openTables ?? []).length > 0;
  const canCancelRequest = Boolean(waitlistEntry && ['Interested', 'Confirmed Coming', 'Arrived'].includes(waitlistEntry.status));
  const alreadyWaiting = canCancelRequest || waitlistEntry?.status === 'Seated';
  const needsMembership = hasOpenTable && !item.isJoined;
  const statusLabel = !hasOpenTable
    ? 'Offered'
    : item.game.availableSeats
      ? `${item.game.availableSeats} open`
      : item.game.formingCount
        ? 'Forming'
        : 'Waitlist';
  const feeProfile = getClubFeeProfile(item.club, item.game);
  const accessProfileText = getAccessProfileText(item.club, item.game);
  const waitlistAheadText = waitlistEntry ? getWaitlistAheadText(waitlistEntry) : '';
  const feedMeta = [
    `${item.club.club.name}`,
    getClubCity(item.club),
    tableLabel ?? '',
    `${item.distanceMiles.toFixed(1)} mi`,
    `${item.game.waitlistCount} waiting`,
    item.game.knownPlayersCount ? `${item.game.knownPlayersCount} familiar` : '',
    item.isPreferred ? 'preferred' : '',
    waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : ''
  ].filter(Boolean).join(' / ');
  return (
    <AnimatedSurface style={styles.gameCard}>
      <View style={styles.gameHeader}>
        <View style={styles.feedAvatar}>
          <Text style={styles.feedAvatarText}>{item.club.club.name.slice(0, 1)}</Text>
        </View>
        <Pressable onPress={onSelectClub} style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{tableLabel ? `${item.game.name} - ${tableLabel}` : item.game.name}</Text>
          <Text style={styles.muted}>{feedMeta}</Text>
        </Pressable>
        <View style={[styles.statusPill, item.game.availableSeats > 0 && styles.openPill]}>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
      </View>
      <View style={styles.feeInfoBand}>
        <Ionicons name="receipt-outline" size={15} color={colors.primaryDark} />
        <View style={[styles.feeTypePill, feeProfile.type === 'rake' && styles.rakeTypePill]}>
          <Text style={[styles.feeTypePillText, feeProfile.type === 'rake' && styles.rakeTypePillText]}>
            {feeProfile.type === 'rake' ? 'DROP' : 'TIME'}
          </Text>
        </View>
        <Text style={styles.feeInfoText}>{accessProfileText}</Text>
      </View>
      {!hasOpenTable ? (
        <View style={styles.offeredGameBand}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.offeredGameText}>This game is offered by the club, but no table is currently open. Say you're interested and Core will add you to tonight's demand.</Text>
        </View>
      ) : null}
      {waitlistEntry ? (
        <View style={styles.waitlistAheadBand}>
          <Ionicons name="people-outline" size={15} color={colors.amber} />
          <Text style={styles.waitlistAheadText}>{waitlistAheadText}</Text>
        </View>
      ) : null}
      {premium ? (
        <>
          <View style={styles.recommendationBand}>
            <View style={styles.recommendationBadge}>
              <Ionicons name="information-circle-outline" size={14} color={colors.teal} />
              <Text style={styles.recommendationBadgeText}>Why this game appears</Text>
            </View>
            <Text style={styles.recommendationText}>{getRecommendationReason(item)}</Text>
          </View>
          <View style={styles.valueRow}>
            <View style={styles.valuePill}>
              <Ionicons name="people-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{item.game.availableSeats ? `${item.game.availableSeats} open seats` : `${item.game.waitlistCount} waiting`}</Text>
            </View>
            <View style={styles.valuePill}>
              <Ionicons name="heart-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{item.isPreferred ? 'Preferred game' : 'Room listing'}</Text>
            </View>
            <View style={styles.valuePill}>
              <Ionicons name="navigate-outline" size={13} color={colors.primaryDark} />
              <Text style={styles.valuePillText}>{item.distanceMiles.toFixed(1)} mi away</Text>
            </View>
          </View>
        </>
      ) : (
        <View style={styles.lockedRecommendationBand}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.muted} />
          <Text style={styles.lockedRecommendationText}>Premium explains why each game appears and can sort by saved preferences.</Text>
        </View>
      )}
      <View style={styles.gameActionRow}>
        <IconActionButton icon="navigate-outline" label={`Directions to ${item.club.club.name}`} onPress={onDirections} />
        <IconActionButton
          icon={canCancelRequest ? 'close-circle-outline' : alreadyWaiting ? 'checkmark-circle' : needsMembership ? 'card-outline' : 'person-add-outline'}
          label={canCancelRequest ? `Cancel request for ${item.game.name}` : alreadyWaiting && waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : needsMembership ? `Join ${item.club.club.name}` : hasOpenTable ? `Request a seat for ${item.game.name}` : `I'm interested in ${item.game.name}`}
          onPress={canCancelRequest ? onCancelWaitlist : alreadyWaiting ? undefined : needsMembership ? onJoinClub : onWaitlist}
          active={canCancelRequest || !alreadyWaiting}
          disabled={alreadyWaiting && !canCancelRequest}
        />
      </View>
    </AnimatedSurface>
  );
}

export function GameCard({
  game,
  waitlistEntry,
  joined,
  preferred,
  onWaitlist,
  onCancelWaitlist,
  onJoinClub
}: {
  game: PlayerSyncGame;
  waitlistEntry?: PlayerWaitlistEntry;
  joined: boolean;
  preferred: boolean;
  onWaitlist: () => void;
  onCancelWaitlist: (entry: PlayerWaitlistEntry) => void;
  onJoinClub: () => void;
}) {
  const hasOpenTable = (game.openTables ?? []).length > 0;
  const canCancelRequest = Boolean(waitlistEntry && ['Interested', 'Confirmed Coming', 'Arrived'].includes(waitlistEntry.status));
  const alreadyWaiting = canCancelRequest || waitlistEntry?.status === 'Seated';
  const buttonAction = canCancelRequest && waitlistEntry
    ? () => onCancelWaitlist(waitlistEntry)
    : alreadyWaiting
      ? undefined
      : !hasOpenTable || joined
        ? onWaitlist
        : onJoinClub;
  const waitlistAheadText = waitlistEntry ? getWaitlistAheadText(waitlistEntry) : '';
  return (
    <AnimatedSurface style={styles.gameCard}>
      <View style={styles.gameHeader}>
        <View style={styles.feedAvatar}>
          <Text style={styles.feedAvatarText}>{game.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.gameTitleBlock}>
          <Text style={styles.cardTitle}>{game.name}</Text>
          <Text style={styles.muted}>{hasOpenTable ? (game.availableSeats ? `${game.availableSeats} seats available` : `${game.waitlistCount} on waitlist`) : 'Offered by club - no table currently open'}</Text>
        </View>
        <View style={[styles.statusPill, game.availableSeats > 0 && styles.openPill]}>
          <Text style={styles.statusText}>{!hasOpenTable ? 'Offered' : game.formingCount ? 'Forming' : game.availableSeats ? 'Open' : 'Full'}</Text>
        </View>
      </View>
      {preferred ? (
        <View style={styles.preferenceBand}>
          <Ionicons name="heart-outline" size={15} color={colors.teal} />
          <Text style={styles.preferenceText}>Preferred game</Text>
        </View>
      ) : null}
      {!hasOpenTable ? (
        <View style={styles.offeredGameBand}>
          <Ionicons name="information-circle-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.offeredGameText}>No table is open right now. Mark yourself interested and the club will see the added demand in Core.</Text>
        </View>
      ) : null}
      <View style={styles.valueRow}>
        <View style={styles.valuePill}>
          <Ionicons name="receipt-outline" size={13} color={colors.primaryDark} />
          <Text style={styles.valuePillText}>{game.collectionMode ?? game.openTables[0]?.collectionMode ?? 'Drop'} collection</Text>
        </View>
        <View style={styles.valuePill}>
          <Ionicons name="time-outline" size={13} color={colors.primaryDark} />
          <Text style={styles.valuePillText}>{game.waitlistCount} waiting</Text>
        </View>
        {game.knownPlayersCount ? (
          <View style={styles.valuePill}>
            <Ionicons name="people-outline" size={13} color={colors.primaryDark} />
            <Text style={styles.valuePillText}>{game.knownPlayersCount} familiar</Text>
          </View>
        ) : null}
        {waitlistEntry ? (
          <View style={[styles.valuePill, styles.waitlistPill]}>
            <Ionicons name="bookmark-outline" size={13} color={colors.amber} />
            <Text style={[styles.valuePillText, styles.waitlistPillText]}>{getPlayerGameStatusLabel(waitlistEntry)}</Text>
          </View>
        ) : null}
      </View>
      {waitlistEntry ? (
        <View style={styles.waitlistAheadBand}>
          <Ionicons name="people-outline" size={15} color={colors.amber} />
          <Text style={styles.waitlistAheadText}>{waitlistAheadText}</Text>
        </View>
      ) : null}
      {game.openTables.map((table) => (
        <View key={table.id} style={styles.tableRow}>
          <View>
            <Text style={styles.tableName}>{table.label}</Text>
            <Text style={styles.muted}>
              {table.social?.seatedPlayerCount ?? table.seatsFilled} players / {table.social?.adminCount ?? 0} admins - {table.collectionMode}
            </Text>
            {table.social?.knownPlayersCount ? <Text style={styles.muted}>{table.social.knownPlayersCount} familiar players at this table</Text> : null}
          </View>
          <Text style={styles.tableSeats}>{table.availableSeats}</Text>
        </View>
      ))}
      <AnimatedButton variant="primary" onPress={buttonAction} disabled={alreadyWaiting && !canCancelRequest} style={[styles.primaryButton, styles.fullWidthButton, alreadyWaiting && !canCancelRequest && styles.disabledButton]}>
        <Ionicons name={canCancelRequest ? 'close-circle-outline' : alreadyWaiting ? 'checkmark-circle' : !hasOpenTable || joined ? 'time-outline' : 'card-outline'} size={18} color="#fff" />
        <Text style={styles.primaryButtonText}>{canCancelRequest ? 'Cancel Request' : alreadyWaiting && waitlistEntry ? getPlayerGameStatusLabel(waitlistEntry) : !hasOpenTable ? "I'm Interested" : joined ? 'Request Seat' : 'Join Club'}</Text>
      </AnimatedButton>
    </AnimatedSurface>
  );
}

export function MyGamesSection({
  games,
  onBuyTime,
  onCancel
}: {
  games: Array<{ club: PlayerClubSnapshot; game: PlayerSyncGame; entry: PlayerWaitlistEntry }>;
  onBuyTime: (club: PlayerClubSnapshot) => void;
  onCancel: (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => void;
}) {
  if (!games.length) return null;
  return (
    <View style={styles.myGamesSection}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>My Games</Text>
          <Text style={styles.muted}>Your active requests and seats</Text>
        </View>
        <View style={styles.myGamesCount}>
          <Text style={styles.myGamesCountText}>{games.length}</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myGamesRail}>
        {games.map(({ club, game, entry }) => {
          const canCancel = ['Interested', 'Confirmed Coming', 'Arrived'].includes(entry.status);
          const sellsTime = getClubFeeProfile(club).type === 'time';
          return (
            <View key={`${club.club.id}:${game.id}`} style={styles.myGameCard}>
              <View style={styles.myGameCardHeader}>
                <View style={styles.myGameStatusIcon}>
                  <Ionicons name={entry.status === 'Seated' ? 'checkmark-circle' : 'time-outline'} size={18} color={colors.primary} />
                </View>
                <View style={styles.myGameCardCopy}>
                  <Text style={styles.cardTitle}>{game.name}</Text>
                  <Text style={styles.muted}>{club.club.name}</Text>
                </View>
              </View>
              <View style={styles.myGameStatusBand}>
                <Text style={styles.myGameStatusLabel}>{getPlayerGameStatusLabel(entry)}</Text>
                <Text style={styles.myGameStatusDetail}>{getWaitlistAheadText(entry)}</Text>
              </View>
              <View style={styles.myGameActions}>
                {sellsTime ? (
                  <Pressable accessibilityLabel={`Buy more time from ${club.club.name}`} accessibilityRole="button" onPress={() => onBuyTime(club)} style={styles.myGamePrimaryAction}>
                    <Ionicons name="timer-outline" size={16} color="#ffffff" />
                    <Text style={styles.myGamePrimaryActionText}>Buy more time</Text>
                  </Pressable>
                ) : null}
                {canCancel ? (
                  <Pressable accessibilityLabel={`Cancel request for ${game.name}`} accessibilityRole="button" onPress={() => onCancel(club, game, entry)} style={styles.myGameSecondaryAction}>
                    <Text style={styles.myGameSecondaryActionText}>Cancel</Text>
                  </Pressable>
                ) : null}
              </View>
              {sellsTime ? <Text style={styles.myGameMerchantNote}>Sold by {club.club.name}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
