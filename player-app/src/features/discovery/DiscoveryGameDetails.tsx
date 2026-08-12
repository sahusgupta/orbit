import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AnimatedButton } from '../../components/PlayerPresentation';
import {
  getCompatibilitySummary,
  getClubCity,
  getGameStatusLabel,
  getOpportunityLabel,
  getOpportunityKey,
  getVenueKind
} from '../../domain/discovery';
import { formatDropFee, getClubFeeProfile } from '../../domain/clubAccess';
import type { PlayerAccount } from '../../domain/playerSync';
import type { GameOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function GameDetailsScreen({
  item,
  player,
  onBack,
  onDirections,
  onJoin,
  onViewStore
}: {
  item: GameOpportunity;
  player: PlayerAccount;
  onBack: () => void;
  onDirections: () => void;
  onJoin: () => void;
  onViewStore: () => void;
}) {
  const fee = getClubFeeProfile(item.club, item.game);
  const hasOpenTable = item.game.openTables.length > 0;
  const venueKind = getVenueKind(item.club);
  return (
    <View style={styles.gameDetailsPage}>
      <View style={styles.gameDetailsNav}>
        <Pressable accessibilityLabel="Back to discovery" accessibilityRole="button" onPress={onBack} style={styles.gameDetailsBack}>
          <Ionicons name="arrow-back" size={19} color={colors.ink} />
          <Text style={styles.gameDetailsBackText}>Discover</Text>
        </Pressable>
        <View style={styles.gameDetailsLivePill}>
          <View style={[styles.liveDot, !item.game.availableSeats && styles.liveDotWarm]} />
          <Text style={styles.gameDetailsLiveText}>Live</Text>
        </View>
      </View>

      <LinearGradient
        colors={['#101827', '#172554', '#4D7CFE']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gameDetailsHero}
      >
        <View style={styles.gameDetailsHeroTop}>
          <View style={styles.venueTypeBadge}>
            <Ionicons name={venueKind === 'Card house' ? 'business-outline' : venueKind === 'Casino' ? 'diamond-outline' : 'people-outline'} size={13} color="#ffffff" />
            <Text style={styles.venueTypeText}>{venueKind}</Text>
          </View>
          <View style={styles.gameDetailsScore}>
            <Text style={styles.gameDetailsScoreValue}>{getOpportunityLabel(item)}</Text>
            <Text style={styles.compatibilityLabel}>WHY SHOWN</Text>
          </View>
        </View>
        <View style={styles.gameDetailsHeroCopy}>
          <Text style={styles.gameDetailsStatus}>{getGameStatusLabel(item.game)}</Text>
          <Text style={styles.gameDetailsTitle}>{item.game.name}</Text>
          <Text style={styles.gameDetailsClub}>{item.club.club.name}</Text>
          <Text style={styles.gameDetailsLocation}>{getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi away</Text>
        </View>
      </LinearGradient>

      <View style={styles.detailsQuickSummary}>
        <Text style={styles.detailsQuickValue}>{item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{item.game.openTables.length || 0} {hasOpenTable ? 'active tables' : 'planned tables'}</Text>
      </View>

      <View style={styles.gameDetailsSection}>
        <View style={styles.gameDetailsSectionHeading}>
          <View style={styles.gameDetailsSectionIcon}>
            <Ionicons name="sparkles-outline" size={18} color={colors.primary} />
          </View>
          <Text style={styles.gameDetailsSectionTitle}>Why this game</Text>
        </View>
        <Text style={styles.gameDetailsReason}>{getCompatibilitySummary(item)}</Text>
      </View>

      <View style={styles.gameDetailsSection}>
        <View style={styles.gameDetailsSectionHeading}>
          <View style={styles.gameDetailsSectionIcon}>
            <Ionicons name="information-circle-outline" size={19} color={colors.primary} />
          </View>
          <Text style={styles.gameDetailsSectionTitle}>At a glance</Text>
        </View>
        <View style={styles.gameDetailsFacts}>
          <DetailRow icon="people-outline" label="Seats" value={item.game.availableSeats ? `${item.game.availableSeats} open now` : `${item.game.waitlistCount} waiting`} />
          <DetailRow icon="layers-outline" label="Tables" value={`${item.game.openTables.length || 0} ${hasOpenTable ? 'open or forming' : 'planned'}`} />
          <DetailRow icon="receipt-outline" label="Collection" value={fee.type === 'time' ? `${fee.hourly} to card house` : formatDropFee(fee.percent)} />
          <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Shared after approval'} />
        </View>
      </View>

      <View style={styles.notificationPromise}>
        <View style={styles.notificationPromiseIcon}>
          <Ionicons name="notifications-outline" size={19} color={colors.primary} />
        </View>
        <View style={styles.notificationPromiseCopy}>
          <Text style={styles.cardTitle}>Alerts after you join</Text>
          <Text style={styles.muted}>We’ll notify you when this host posts {player.preferredStakes || 'your usual stakes'}.</Text>
        </View>
      </View>

      {!item.isJoined ? (
        <Pressable onPress={onViewStore} style={styles.storeButton}>
          <Ionicons name="storefront-outline" size={18} color={colors.primary} />
          <View style={styles.storeButtonCopy}>
            <Text style={styles.storeButtonText}>Access options</Text>
            <Text style={styles.muted}>Passes and time sold by {item.club.club.name}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable>
      ) : null}

      <View style={styles.detailsActionRow}>
        <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} accessibilityRole="button" onPress={onDirections} style={styles.detailsSecondaryButton}>
          <Ionicons name="navigate-outline" size={18} color={colors.ink} />
          <Text style={styles.detailsSecondaryText}>Directions</Text>
        </Pressable>
        <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
          <Ionicons name={item.isJoined ? 'person-add-outline' : 'card-outline'} size={18} color="#ffffff" />
          <Text style={styles.primaryButtonText}>{item.isJoined ? (hasOpenTable ? 'Request a seat' : 'Follow this game') : 'See how to join'}</Text>
        </AnimatedButton>
      </View>
    </View>
  );
}

export function DiscoveryDetailsModal({
  item,
  player,
  onClose,
  onDirections,
  onJoin,
  onViewStore
}: {
  item: GameOpportunity | null;
  player: PlayerAccount;
  onClose: () => void;
  onDirections: () => void;
  onJoin: () => void;
  onViewStore: () => void;
}) {
  const [expandedSection, setExpandedSection] = useState<'fit' | 'details' | null>(null);
  useEffect(() => setExpandedSection(null), [item ? getOpportunityKey(item) : '']);
  if (!item) return null;
  const fee = getClubFeeProfile(item.club, item.game);
  const hasOpenTable = item.game.openTables.length > 0;
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.discoveryDetailsSheet}>
          <View style={styles.sheetHandle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.discoveryDetailsContent}>
            <View style={styles.discoveryDetailsHeader}>
              <View style={styles.discoveryDetailsScore}>
                <Text style={styles.discoveryDetailsScoreValue}>{getOpportunityLabel(item)}</Text>
                <Text style={styles.compatibilityLabel}>WHY SHOWN</Text>
              </View>
              <View style={styles.discoveryDetailsTitleBlock}>
                <Text style={styles.agentKicker}>{getVenueKind(item.club)} · {getGameStatusLabel(item.game)}</Text>
                <Text style={styles.membershipTitle}>{item.game.name}</Text>
                <Text style={styles.muted}>{item.club.club.name} · {getClubCity(item.club)} · {item.distanceMiles.toFixed(1)} mi</Text>
              </View>
              <Pressable accessibilityLabel="Close game details" accessibilityRole="button" onPress={onClose} style={styles.modalCloseButton}>
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>

            <View style={styles.detailsQuickSummary}>
              <Text style={styles.detailsQuickValue}>{item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{fee.type === 'time' ? fee.hourly : formatDropFee(fee.percent)}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{item.distanceMiles.toFixed(1)} mi</Text>
            </View>

            <View style={styles.detailsDisclosureGroup}>
              <Pressable accessibilityLabel="Why this appears" accessibilityRole="button" accessibilityState={{ expanded: expandedSection === 'fit' }} onPress={() => setExpandedSection((current) => current === 'fit' ? null : 'fit')} style={styles.detailsDisclosureRow}>
                <View style={styles.detailsDisclosureLabel}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardTitle}>Why this appears</Text>
                </View>
                <Ionicons name={expandedSection === 'fit' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {expandedSection === 'fit' ? (
                <View style={styles.fitBreakdown}>
                  <DetailRow icon="heart-outline" label="Preferences" value={item.isPreferred ? 'Saved game preference' : 'Available room listing'} />
                  <DetailRow icon="people-outline" label="Availability" value={item.game.availableSeats ? `${item.game.availableSeats} seats open` : `${item.game.waitlistCount} waiting`} />
                  <DetailRow icon="person-outline" label="Familiar players" value={`${item.game.knownPlayersCount || 0} listed`} />
                  <DetailRow icon="navigate-outline" label="Distance" value={`${item.distanceMiles.toFixed(1)} mi away`} />
                </View>
              ) : null}
              <Pressable accessibilityLabel="Game details" accessibilityRole="button" accessibilityState={{ expanded: expandedSection === 'details' }} onPress={() => setExpandedSection((current) => current === 'details' ? null : 'details')} style={styles.detailsDisclosureRow}>
                <View style={styles.detailsDisclosureLabel}>
                  <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
                  <Text style={styles.cardTitle}>Game details</Text>
                </View>
                <Ionicons name={expandedSection === 'details' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
              </Pressable>
              {expandedSection === 'details' ? (
                <View style={styles.detailsInfoCard}>
                  <DetailRow icon="people-outline" label="Seats" value={item.game.availableSeats ? `${item.game.availableSeats} open now` : `${item.game.waitlistCount} waiting`} />
                  <DetailRow icon="layers-outline" label="Tables" value={`${item.game.openTables.length || 0} ${hasOpenTable ? 'open or forming' : 'planned'}`} />
                  <DetailRow icon="receipt-outline" label="Collection" value={fee.type === 'time' ? `${fee.hourly} to card house` : formatDropFee(fee.percent)} />
                  <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Shared after approval'} />
                </View>
              ) : null}
            </View>

            <View style={styles.notificationPromise}>
              <View style={styles.notificationPromiseIcon}>
                <Ionicons name="notifications-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.notificationPromiseCopy}>
                <Text style={styles.cardTitle}>Alerts after you join</Text>
                <Text style={styles.muted}>We’ll notify you when this host posts {player.preferredStakes || 'your usual stakes'}.</Text>
              </View>
            </View>

            {!item.isJoined ? (
              <Pressable onPress={onViewStore} style={styles.storeButton}>
                <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                <View style={styles.storeButtonCopy}>
                  <Text style={styles.storeButtonText}>Access options</Text>
                  <Text style={styles.muted}>Passes and time sold by {item.club.club.name}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.primary} />
              </Pressable>
            ) : null}

            <View style={styles.detailsActionRow}>
              <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} accessibilityRole="button" onPress={onDirections} style={styles.detailsSecondaryButton}>
                <Ionicons name="navigate-outline" size={18} color={colors.ink} />
                <Text style={styles.detailsSecondaryText}>Directions</Text>
              </Pressable>
              <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
                <Ionicons name={item.isJoined ? 'person-add-outline' : 'card-outline'} size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText}>{item.isJoined ? (hasOpenTable ? 'Request a seat' : 'Follow this game') : 'See how to join'}</Text>
              </AnimatedButton>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DetailRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailRowLabel}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text style={styles.muted}>{label}</Text>
      </View>
      <Text style={styles.detailRowValue}>{value}</Text>
    </View>
  );
}
