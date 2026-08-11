import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedButton } from '../../components/PlayerPresentation';
import { getClubFeeProfile, getClubProductName } from '../../domain/clubAccess';
import type {
  PlayerAccount,
  PlayerMembership,
  PlayerClubSnapshot,
  PlayerMembershipOption,
  PlayerSyncGame,
  PlayerTournament,
  PlayerWaitlistEntry
} from '../../domain/playerSync';
import { getClubDistance, isActivePlayerGame } from '../../domain/discovery';
import type { ClubAccessProduct, Coordinate, SeatRequestDraft } from '../../domain/playerTypes';
import { isPlayerMembership } from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { ClubHubSections } from './ClubHub';
import { MembershipApplicationStatusCard, MembershipWalletCard } from './MembershipWallet';
import { clubStyles } from './clubStyles';

const styles = { ...sharedStyles, ...clubStyles };

export function ClubsScreen({
  memberClubs,
  selectedClub,
  selectedMembership,
  player,
  originCoordinate,
  nowMs,
  message,
  waitlists,
  tournaments,
  onSelectClub,
  onGame,
  onManageAccess,
  onViewEvents
}: {
  memberClubs: PlayerClubSnapshot[];
  selectedClub: PlayerClubSnapshot;
  selectedMembership?: PlayerMembership;
  player: PlayerAccount;
  originCoordinate: Coordinate;
  nowMs: number;
  message: string;
  waitlists: PlayerWaitlistEntry[];
  tournaments: PlayerTournament[];
  onSelectClub: (club: PlayerClubSnapshot) => void;
  onGame: (game: PlayerSyncGame) => void;
  onManageAccess: () => void;
  onViewEvents: () => void;
}) {
  return (
    <>
      {memberClubs.length ? memberClubs
        .slice()
        .sort((left, right) => getClubDistance(left, originCoordinate) - getClubDistance(right, originCoordinate))
        .map((club) => {
          const isSelected = club.club.id === selectedClub.club.id;
          const membership = club.memberships.find((item) => isPlayerMembership(item, player));
          const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
          const familiarText = club.social?.knownPlayersInHouse ? ` - ${club.social.knownPlayersInHouse} familiar players` : '';
          return (
            <Pressable
              key={club.club.id}
              onPress={() => onSelectClub(club)}
              style={[styles.clubCard, isSelected && styles.selectedCard]}
            >
              <View style={[styles.clubAvatar, isSelected && styles.clubAvatarActive]}>
                <Text style={[styles.clubAvatarText, isSelected && styles.clubAvatarTextActive]}>{club.club.name.slice(0, 1)}</Text>
              </View>
              <View style={styles.clubMain}>
                <Text style={styles.cardTitle}>{club.club.name}</Text>
                <Text style={styles.muted}>
                  {getClubDistance(club, originCoordinate).toFixed(1)} mi - {openSeats} seats{familiarText}
                </Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusText}>{membership?.status ?? 'Join'}</Text>
              </View>
            </Pressable>
          );
        }) : (
          <View style={styles.emptyState}>
            <Text style={styles.cardTitle}>No club memberships yet</Text>
            <Text style={styles.muted}>Join a card house from Find Games and your memberships will show here.</Text>
          </View>
        )}

      {selectedMembership ? (
        <>
          {selectedMembership.status === 'Requested' ? (
            <MembershipApplicationStatusCard club={selectedClub} membership={selectedMembership} />
          ) : (
            <MembershipWalletCard
              club={selectedClub}
              membership={selectedMembership}
              nowMs={nowMs}
              player={player}
            />
          )}
          {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
          <ClubHubSections
            club={selectedClub}
            membership={selectedMembership}
            games={selectedClub.games}
            waitlists={waitlists}
            tournaments={tournaments}
            nowMs={nowMs}
            onGame={onGame}
            onManageAccess={onManageAccess}
            onViewEvents={onViewEvents}
          />
        </>
      ) : null}
    </>
  );
}

export function ClubMembershipPlanScreen({
  club,
  prices,
  message,
  player,
  busy,
  onBack,
  onSubmit
}: {
  club: PlayerClubSnapshot;
  prices: { day: string; monthly: string; timePack: string };
  message: string;
  player: PlayerAccount;
  busy: boolean;
  onBack: () => void;
  onSubmit: (membershipOption?: PlayerMembershipOption) => void;
}) {
  const membershipOptions: PlayerMembershipOption[] = club.club.membershipOptions?.length
    ? club.club.membershipOptions
    : [
        { id: 'day', name: 'Day Pass', priceLabel: prices.day, durationDays: 1 },
        { id: 'monthly', name: 'Monthly Membership', priceLabel: prices.monthly, durationDays: 30 },
        ...(getClubFeeProfile(club).type === 'time'
          ? [{ id: 'time-5', name: '5-Hour Time Pack', priceLabel: prices.timePack, durationDays: 1 }]
          : [])
      ];
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
          <Text style={styles.muted}>Your identity and poker profile are shared securely with this card house. Nothing needs to be entered again.</Text>
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
        <Text style={styles.muted}>Optional</Text>
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

      <AnimatedButton disabled={busy} variant="primary" onPress={() => onSubmit(selectedOption)} style={[styles.primaryButton, styles.fullWidthButton]}>
        <Ionicons name="person-add-outline" size={18} color="#ffffff" />
        <Text style={styles.primaryButtonText}>{busy ? 'Sending request...' : selectedOption ? `Request ${selectedOption.name}` : 'Request membership'}</Text>
      </AnimatedButton>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </View>
  );
}

export function SeatRequestModal({
  draft,
  message,
  busy,
  onChange,
  onClose,
  onSubmit
}: {
  draft: SeatRequestDraft | null;
  message: string;
  busy: boolean;
  onChange: React.Dispatch<React.SetStateAction<SeatRequestDraft | null>>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!draft) return null;
  const hasOpenTable = isActivePlayerGame(draft.game);
  const update = (patch: Partial<SeatRequestDraft>) => onChange((current) => current ? { ...current, ...patch } : current);
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.seatRequestModal}>
          <View style={styles.seatRequestHeader}>
            <View style={styles.seatRequestHeaderCopy}>
              <Text style={styles.agentKicker}>{draft.club.club.name}</Text>
              <Text style={styles.membershipTitle}>{hasOpenTable ? `Join ${draft.game.name}` : `When would you play ${draft.game.name}?`}</Text>
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
                style={[styles.attendanceChoice, draft.attendance === 'arrived' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'arrived', expectedArrivalTime: '' })}
              >
                <Ionicons name="location-outline" size={20} color={draft.attendance === 'arrived' ? '#fff' : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>At club now</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'arrived' && styles.attendanceChoiceTextActive]}>Mark me arrived</Text>
              </Pressable>
              <Pressable
                style={[styles.attendanceChoice, draft.attendance === 'confirmed' && styles.attendanceChoiceActive]}
                onPress={() => update({ attendance: 'confirmed' })}
              >
                <Ionicons name="time-outline" size={20} color={draft.attendance === 'confirmed' ? '#fff' : colors.primary} />
                <Text style={[styles.attendanceChoiceTitle, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Coming later</Text>
                <Text style={[styles.attendanceChoiceBody, draft.attendance === 'confirmed' && styles.attendanceChoiceTextActive]}>Confirm a time</Text>
              </Pressable>
            </View>
          ) : null}

          {hasOpenTable && draft.attendance === 'confirmed' ? (
            <View style={styles.seatTimeField}>
              <Text style={styles.inputLabel}>Expected arrival time</Text>
              <TextInput
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
                  value={draft.availabilityStartTime}
                  onChangeText={(availabilityStartTime) => update({ attendance: 'interested', availabilityStartTime })}
                  placeholder="From, e.g. 6 PM"
                  placeholderTextColor={colors.muted}
                  style={[styles.seatTimeInput, styles.timeRangeInput]}
                />
                <TextInput
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
          <AnimatedButton disabled={busy} variant="primary" onPress={onSubmit} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Ionicons name={draft.attendance === 'arrived' ? 'location-outline' : 'checkmark-circle-outline'} size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{busy ? 'Sending...' : draft.attendance === 'arrived' ? 'Tell club I am here' : 'Send request'}</Text>
          </AnimatedButton>
        </View>
      </View>
    </Modal>
  );
}

export function ClubAccessCheckoutScreen({
  club,
  product,
  price,
  message,
  connectedCheckoutEnabled,
  busy,
  onBack,
  onPayInApp,
  onPayInPerson
}: {
  club: PlayerClubSnapshot;
  product: ClubAccessProduct;
  price: string;
  message: string;
  connectedCheckoutEnabled: boolean;
  busy: boolean;
  onBack: () => void;
  onPayInApp: () => void;
  onPayInPerson: () => void;
}) {
  return (
    <View style={styles.membershipScreen}>
      <Pressable style={styles.inlineBackAction} onPress={onBack}>
        <Ionicons name="chevron-back" size={17} color={colors.primary} />
        <Text style={styles.inlineBackText}>Membership</Text>
      </Pressable>
      <View style={styles.paymentPlaceholder}>
        <View style={styles.paymentPlaceholderIcon}>
          <Ionicons name={connectedCheckoutEnabled ? 'card-outline' : 'person-add-outline'} size={28} color={colors.primary} />
        </View>
        <Text style={styles.membershipTitle}>{connectedCheckoutEnabled ? 'Payment' : 'Review application'}</Text>
        <Text style={styles.muted}>
          {club.club.name} / {getClubProductName(product)} / {price}
        </Text>
      </View>
      {connectedCheckoutEnabled ? (
        <>
          <View style={styles.merchantBand}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.teal} />
            <Text style={styles.merchantBandText}>Sold and fulfilled by {club.club.name}. Orbit securely passes you to the card house’s connected checkout.</Text>
          </View>
          <AnimatedButton disabled={busy} variant="primary" onPress={onPayInApp} style={[styles.primaryButton, styles.fullWidthButton]}>
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
            <Text style={styles.primaryButtonText}>{busy ? 'Opening checkout...' : 'Continue to card house checkout'}</Text>
          </AnimatedButton>
        </>
      ) : null}
      <Pressable disabled={busy} style={[styles.payInPersonButton, busy && styles.disabledAction]} onPress={onPayInPerson}>
        <Ionicons name="storefront-outline" size={18} color={colors.ink} />
        <View style={styles.payInPersonCopy}>
          <Text style={styles.cardTitle}>{connectedCheckoutEnabled ? 'Pay in person' : 'Send membership application'}</Text>
          <Text style={styles.muted}>{connectedCheckoutEnabled ? 'Staff will confirm payment and activate your access.' : 'The card room will review it. After approval, bring your ID and pay at the door.'}</Text>
        </View>
      </Pressable>
      {message ? <Text style={styles.privateGameStatus}>{message}</Text> : null}
    </View>
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
  return (
    <Pressable accessibilityState={{ selected }} style={[styles.planCard, selected && styles.planCardFeatured]} onPress={onPress}>
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
