import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedButton } from '../../components/PlayerPresentation';
import type {
  PlayerAccount,
  PlayerMembership,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerWaitlistEntry
} from '../../domain/playerSync';
import { getClubAvailabilityLabel, getClubCity, getClubDistance, hasRunningTable } from '../../domain/discovery';
import type { PlayerClubsViewState } from '../../domain/playerClubViewState';
import type { Coordinate, SeatRequestDraft } from '../../domain/playerTypes';
import { isMembershipCurrentlyActive, isPlayerMembership } from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { ClubHubSections, PlayerTimePanel } from './ClubHub';
import { MembershipApplicationStatusCard, MembershipWalletCard } from './MembershipWallet';
import { MembershipPassWallet } from './MembershipPass';
import { membershipPresentation as presentation, useMembershipPalette } from './membershipPresentation';
import { clubStyles } from './clubStyles';

const baseStyles = { ...sharedStyles, ...clubStyles };

function formatClubDistance(club: PlayerClubSnapshot, originCoordinate: Coordinate | null) {
  const distance = getClubDistance(club, originCoordinate);
  return distance == null ? '' : `${distance.toFixed(1)} mi`;
}

function compareClubDistance(left: PlayerClubSnapshot, right: PlayerClubSnapshot, originCoordinate: Coordinate | null) {
  const leftDistance = getClubDistance(left, originCoordinate);
  const rightDistance = getClubDistance(right, originCoordinate);
  if (leftDistance == null && rightDistance == null) return left.club.name.localeCompare(right.club.name);
  if (leftDistance == null) return 1;
  if (rightDistance == null) return -1;
  return leftDistance - rightDistance;
}

export function ClubsScreen({
  memberClubs,
  selectedMembership,
  viewState,
  player,
  originCoordinate,
  nowMs,
  message,
  waitlists,
  tournaments,
  onSelectClub,
  onOpenMembership,
  onGame,
  onManageAccess,
  onViewEvents,
  demoMode = false
}: {
  memberClubs: PlayerClubSnapshot[];
  selectedMembership?: PlayerMembership;
  viewState: PlayerClubsViewState;
  player: PlayerAccount;
  originCoordinate: Coordinate | null;
  nowMs: number;
  message: string;
  waitlists: PlayerWaitlistEntry[];
  tournaments: PlayerTournament[];
  onSelectClub: (club: PlayerClubSnapshot) => void;
  onOpenMembership?: (club: PlayerClubSnapshot) => void;
  onGame: (game: PlayerSyncGame) => void;
  onManageAccess: () => void;
  onViewEvents: () => void;
  demoMode?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const palette = useMembershipPalette();
  // Club-dependent panels contain actions. Render them only for a current,
  // successfully refreshed selection; stale/removed states stay read-only.
  const renderableClub = viewState.kind === 'ready' ? viewState.selectedClub : undefined;
  return (
    <>
      {onOpenMembership ? (
        <View style={presentation.intro}>
          <Text style={[presentation.eyebrow, { color: palette.accent }]}>MEMBERSHIPS</Text>
          <Text accessibilityRole="header" style={[presentation.heading, { color: palette.ink }]}>Your wallet</Text>
          <Text style={[presentation.body, { color: palette.muted }]}>Your rooms. Your access. All in one place.</Text>
        </View>
      ) : null}
      {viewState.kind === 'loading' ? (
        <View accessibilityLabel="Loading clubs" accessibilityRole="progressbar" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Loading your clubs</Text>
          <Text style={styles.muted}>Memberships and venue-published updates will appear when the refresh completes.</Text>
        </View>
      ) : null}
      {viewState.kind === 'offline' ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Clubs unavailable offline</Text>
          <Text style={styles.muted}>Orbit has no previously loaded club data to show. Reconnect and retry published data.</Text>
        </View>
      ) : null}
      {viewState.kind === 'stale' ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Showing last loaded club data</Text>
          <Text style={styles.muted}>Orbit could not refresh this information. Actions still require a successful connection.</Text>
        </View>
      ) : null}
      {viewState.kind === 'removed' ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Club selection changed</Text>
          <Text style={styles.muted}>{viewState.message}</Text>
        </View>
      ) : null}
      {'partial' in viewState && viewState.partial ? (
        <View accessibilityLiveRegion="polite" style={styles.emptyState}>
          <Text style={styles.cardTitle}>More clubs are still loading</Text>
          <Text style={styles.muted}>The memberships shown below come from the rooms loaded so far.</Text>
        </View>
      ) : null}
      {onOpenMembership && memberClubs.length ? (
        <View style={presentation.section}>
          <MembershipPassWallet clubs={memberClubs.slice().sort((left, right) => compareClubDistance(left, right, originCoordinate))}
            player={player} nowMs={nowMs} onSelectClub={onOpenMembership} selectedClubId={renderableClub?.club.id} />
          {memberClubs.some((club) => club.memberships.some((item) => item.clubId === club.club.id && isPlayerMembership(item, player)))
            ? <Text style={[presentation.body, { color: palette.muted }]}>Tap a card to isolate it. Tap it again to open your club pass.</Text> : null}
        </View>
      ) : null}
      {memberClubs.length ? memberClubs
        .slice()
        .sort((left, right) => compareClubDistance(left, right, originCoordinate))
        .filter((club) => !onOpenMembership || !club.memberships.some((item) => item.clubId === club.club.id && isPlayerMembership(item, player)))
        .map((club) => {
          const isSelected = club.club.id === renderableClub?.club.id;
          const membership = club.memberships.find((item) => isPlayerMembership(item, player));
          const status = membership?.status === 'Active' && !isMembershipCurrentlyActive(membership, nowMs)
            ? 'Expired' : membership?.status ?? (club.timeAccess?.linked ? 'Core linked' : 'Join');
          const availability = getClubAvailabilityLabel(club);
          const location = club.club.address?.trim() ? getClubCity(club) : '';
          const familiar = club.social?.knownPlayersInHouse ? `${club.social.knownPlayersInHouse} familiar players` : '';
          const detail = [location, formatClubDistance(club, originCoordinate), availability, familiar].filter(Boolean).join(' · ');
          return (
            <Pressable
              key={club.club.id}
              accessibilityRole="button"
              accessibilityLabel={`${club.club.name}, ${status}`}
              accessibilityState={{ selected: isSelected }}
              onPress={() => (onOpenMembership ?? onSelectClub)(club)}
              style={[styles.clubVenueRow, isSelected && styles.selectedCard]}
            >
              <View style={[styles.clubAvatar, isSelected && styles.clubAvatarActive]}>
                <Text style={[styles.clubAvatarText, isSelected && styles.clubAvatarTextActive]}>{club.club.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.clubVenueCopy}>
                <Text style={styles.cardTitle}>{club.club.name}</Text>
                <Text style={styles.muted}>{detail}</Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{status}</Text>
              </View>
              {onOpenMembership ? <Ionicons name="chevron-forward" size={18} color={colors.muted} /> : null}
            </Pressable>
          );
        }) : viewState.kind === 'empty' ? (
          <View style={styles.emptyState}>
            <Text style={styles.cardTitle}>No club memberships yet</Text>
            <Text style={styles.muted}>Request venue access from Find Games and published memberships will show here.</Text>
          </View>
        ) : null}

      {!onOpenMembership && selectedMembership && renderableClub ? (
        <>
          {selectedMembership.status === 'Requested' ? (
            <MembershipApplicationStatusCard club={renderableClub} membership={selectedMembership} />
          ) : (
            <MembershipWalletCard
              club={renderableClub}
              membership={selectedMembership}
              nowMs={nowMs}
              player={player}
              demoMode={demoMode}
            />
          )}
          {message ? <Text style={styles.actionStatus}>{message}</Text> : null}
          <ClubHubSections
            club={renderableClub}
            membership={selectedMembership}
            games={renderableClub.games}
            waitlists={waitlists}
            tournaments={tournaments}
            nowMs={nowMs}
            onGame={onGame}
            onManageAccess={onManageAccess}
            onViewEvents={onViewEvents}
          />
        </>
      ) : null}
      {!onOpenMembership && renderableClub ? <PlayerTimePanel club={renderableClub} message={message} /> : null}
    </>
  );
}

export function ClubMembershipPlanScreen({
  club,
  message,
  player,
  busy,
  onBack,
  onSubmit
}: {
  club: PlayerClubSnapshot;
  message: string;
  player: PlayerAccount;
  busy: boolean;
  onBack: () => void;
  onSubmit: (membershipOption?: PlayerMembershipOption) => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const membershipOptions: PlayerMembershipOption[] = club.club.membershipOptions ?? [];
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const selectedOption = membershipOptions.find((option) => option.id === selectedOptionId);
  return (
    <View style={styles.membershipScreen}>
      <Pressable style={styles.inlineBackAction} onPress={onBack}>
        <Ionicons name="chevron-back" size={17} color={colors.primary} />
        <Text style={styles.inlineBackText}>Clubs</Text>
      </Pressable>
      <View style={styles.membershipHero}>
        <View style={styles.membershipHeroIcon}>
          <Text style={styles.membershipHeroText}>{club.club.name.slice(0, 1)}</Text>
        </View>
        <View style={styles.membershipHeroCopy}>
          <Text style={styles.membershipTitle}>{club.club.name}</Text>
          {club.club.address ? <Text style={styles.muted}>{club.club.address}</Text> : null}
        </View>
      </View>

      <View style={styles.membershipApplicationCard}>
        <View>
          <Text style={styles.cardTitle}>Apply with your Orbit profile</Text>
          <Text style={styles.muted}>Your identity and poker profile are shared securely with this venue. Nothing needs to be entered again.</Text>
        </View>
        <View style={styles.membershipProfileSummary}>
          <View style={styles.membershipProfileAvatar}>
            <Text style={styles.membershipProfileAvatarText}>{player.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={styles.membershipProfileCopy}>
            <Text style={styles.cardTitle}>{player.name}</Text>
            <Text style={styles.muted}>Orbit Player profile</Text>
          </View>
          <Ionicons name="shield-checkmark-outline" size={21} color={colors.teal} />
        </View>
      </View>

      <View>
        <Text style={styles.cardTitle}>Available options</Text>
        <Text style={styles.muted}>Select one</Text>
      </View>
      <View style={styles.planGrid}>
        {membershipOptions.map((option) => (
          <MembershipPlanCard
            key={option.id}
            icon={option.durationDays === 1 ? 'today-outline' : 'calendar-outline'}
            title={option.name}
            price={option.priceLabel}
            description={option.description}
            selected={selectedOptionId === option.id}
            onPress={() => setSelectedOptionId((current) => current === option.id ? null : option.id)}
          />
        ))}
      </View>

      {!membershipOptions.length ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>No membership options published</Text>
          <Text style={styles.muted}>This venue has not published a membership option that Orbit can request. Contact the venue directly for current terms.</Text>
        </View>
      ) : null}

      <AnimatedButton disabled={busy || !selectedOption} variant="primary" onPress={() => onSubmit(selectedOption)} style={[styles.primaryButton, styles.fullWidthButton, { marginTop: 'auto' }]}>
        <Ionicons name="person-add-outline" size={18} color={colors.onPrimary} />
        <Text style={styles.primaryButtonText}>{busy ? 'Sending request...' : selectedOption ? `Request ${selectedOption.name}` : 'Choose an option'}</Text>
      </AnimatedButton>
      {message ? <Text style={styles.actionStatus}>{message}</Text> : null}
    </View>
  );
}

export function SeatRequestModal({
  draft,
  message,
  busy,
  readOnly = false,
  onChange,
  onClose,
  onSubmit
}: {
  draft: SeatRequestDraft | null;
  message: string;
  busy: boolean;
  readOnly?: boolean;
  onChange: React.Dispatch<React.SetStateAction<SeatRequestDraft | null>>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  if (!draft) return null;
  const hasOpenTable = hasRunningTable(draft.game);
  const update = (patch: Partial<SeatRequestDraft>) => onChange((current) => current ? { ...current, ...patch } : current);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.seatRequestModal}>
          <View style={styles.seatRequestHeader}>
            <View style={styles.seatRequestHeaderCopy}>
              <Text style={styles.agentKicker}>{draft.club.club.name}</Text>
              <Text style={styles.membershipTitle}>{hasOpenTable ? `Request a seat for ${draft.game.name}` : `When would you play ${draft.game.name}?`}</Text>
              <Text style={styles.muted}>{hasOpenTable
                ? 'Tell the club whether you are already there or when you are coming.'
                : 'This game is offered, but no table is open. Share when you would come so the club can form one.'}</Text>
            </View>
            <Pressable style={styles.modalCloseButton} onPress={onClose}>
              <Ionicons name="close" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {hasOpenTable ? (
            <View style={styles.attendanceChoiceRow}>
              <Pressable
                disabled={readOnly}
                style={[styles.attendanceChoice, draft.attendance === 'arrived' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'arrived', expectedArrivalTime: '' })}
              >
                <Ionicons name="location-outline" size={20} color={draft.attendance === 'arrived' ? colors.onPrimary : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>At club now</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>Mark me arrived</Text>
              </Pressable>
              <Pressable
                disabled={readOnly}
                style={[styles.attendanceChoice, draft.attendance === 'confirmed' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'confirmed' })}
              >
                <Ionicons name="time-outline" size={20} color={draft.attendance === 'confirmed' ? colors.onPrimary : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Coming later</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Confirm a time</Text>
              </Pressable>
            </View>
          ) : null}

          {hasOpenTable && draft.attendance === 'confirmed' ? (
            <View style={styles.seatTimeField}>
              <Text style={styles.inputLabel}>Expected arrival time</Text>
              <TextInput
                editable={!readOnly}
                value={draft.expectedArrivalTime}
                onChangeText={(expectedArrivalTime) => update({ expectedArrivalTime })}
                placeholder="Example: 7:30 PM"
                placeholderTextColor={colors.muted}
                style={styles.seatTimeInput}
              />
            </View>
          ) : null}

          {!hasOpenTable ? (
            <View style={styles.seatTimeField}>
              <Text style={styles.inputLabel}>Time or range you would come</Text>
              <View style={styles.timeRangeRow}>
                <TextInput
                  editable={!readOnly}
                  value={draft.availabilityStartTime}
                  onChangeText={(availabilityStartTime) => update({ attendance: 'interested', availabilityStartTime })}
                  placeholder="From, e.g. 6 PM"
                  placeholderTextColor={colors.muted}
                  style={[styles.seatTimeInput, styles.timeRangeInput]}
                />
                <TextInput
                  editable={!readOnly}
                  value={draft.availabilityEndTime}
                  onChangeText={(availabilityEndTime) => update({ attendance: 'interested', availabilityEndTime })}
                  placeholder="To, e.g. 10 PM"
                  placeholderTextColor={colors.muted}
                  style={[styles.seatTimeInput, styles.timeRangeInput]}
                />
              </View>
            </View>
          ) : null}

          {message ? <Text style={styles.formError}>{message}</Text> : null}
          {readOnly ? <Text accessibilityRole="alert" style={styles.formError}>Refresh published venue data before sending this request.</Text> : null}
          <AnimatedButton disabled={busy || readOnly} variant="primary" onPress={onSubmit} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Ionicons name={draft.attendance === 'arrived' ? 'location-outline' : 'checkmark-circle-outline'} size={18} color={colors.onPrimary} />
            <Text style={styles.primaryButtonText}>{readOnly ? 'Refresh required' : busy ? 'Sending...' : draft.attendance === 'arrived' ? 'Tell club I am here' : 'Send request'}</Text>
          </AnimatedButton>
        </View>
      </View>
    </Modal>
  );
}

export function MembershipPlanCard({
  icon,
  title,
  price,
  description,
  selected,
  onPress
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  price: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
}) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  return (
    <Pressable accessibilityLabel={`${title}, ${price}`} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.planCard, selected && styles.planCardFeatured]} onPress={onPress}>
      <View style={styles.planIcon}>
        <Ionicons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.planCardCopy}>
        <Text style={styles.cardTitle}>{title}</Text>
        {description ? <Text style={styles.muted} numberOfLines={2}>{description}</Text> : null}
      </View>
      <View style={styles.planCardPriceBlock}>
        <Text style={styles.planCompactPrice}>{price}</Text>
        <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={selected ? colors.primary : colors.muted} />
      </View>
    </Pressable>
  );
}
