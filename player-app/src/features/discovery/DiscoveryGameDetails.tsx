import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { AnimatedButton } from '../../components/PlayerPresentation';
import {
  getCompatibilitySummary,
  getClubCity,
  getGameStatusLabel,
  getPublishedAvailabilityLabel,
  getOpportunityLabel,
  getOpportunityKey,
  hasRunningTable,
  getPublishedTableSummary,
  getVenueKind
} from '../../domain/discovery';
import { getClubFeeProfile } from '../../domain/clubAccess';
import type { PlayerAccount, PlayerSeatRequestAccess } from '../../domain/playerSync';
import type { GameOpportunity } from '../../domain/playerTypes';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function getSeatRequestActionLabel(access: PlayerSeatRequestAccess, runningTablePublished: boolean) {
  if (access === 'active') return runningTablePublished ? 'Request a seat' : 'Send interest';
  if (access === 'pending') return 'Await venue activation';
  if (access === 'renewal') return 'Renew access';
  return 'See access options';
}

function getSeatAccessOptionCopy(access: PlayerSeatRequestAccess, clubName: string) {
  if (access === 'pending') {
    return {
      title: 'Membership activation pending',
      body: `Wait for ${clubName} to activate your membership before requesting a seat.`
    };
  }
  if (access === 'renewal') {
    return {
      title: 'Renew access',
      body: `Review the options published by ${clubName} before requesting a seat.`
    };
  }
  return {
    title: 'Access options',
    body: `Review options published by ${clubName}; any fee is collected in person.`
  };
}

export function GameDetailsScreen({
  backLabel,
  item,
  player,
  onBack,
  onDirections,
  onJoin,
  onRefresh,
  readOnly = false,
  onViewStore
}: {
  backLabel: 'Home' | 'Matches';
  item: GameOpportunity | null;
  player: PlayerAccount;
  onBack: () => void;
  onDirections: () => void;
  onJoin: () => void;
  onRefresh: () => void;
  readOnly?: boolean;
  onViewStore: () => void;
}) {
  if (!item || readOnly) {
    return (
      <View accessibilityRole="alert" style={styles.gameDetailsPage}>
        <Pressable accessibilityLabel={`Back to ${backLabel}`} accessibilityRole="button" onPress={onBack} style={styles.inlineBackAction}>
          <Ionicons name="arrow-back" size={19} color={colors.ink} />
          <Text style={styles.inlineBackText}>{backLabel}</Text>
        </Pressable>
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>{item ? 'This listing could not be refreshed' : 'This listing is no longer available'}</Text>
          <Text style={styles.muted}>{item
            ? 'Previously loaded details may be out of date. Actions stay unavailable until Orbit refreshes current venue data.'
            : 'The venue no longer publishes this game in the current catalog. Return to current matches or refresh.'}</Text>
          <Pressable accessibilityRole="button" onPress={onRefresh} style={styles.compactButton}>
            <Text style={styles.compactButtonText}>Refresh current listings</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  const fee = getClubFeeProfile(item.club, item.game);
  const runningTablePublished = hasRunningTable(item.game);
  const accessOptionCopy = getSeatAccessOptionCopy(item.seatRequestAccess, item.club.club.name);
  const venueKind = getVenueKind(item.club);
  return (
    <View style={styles.gameDetailsPage}>
      <View style={styles.gameDetailsNav}>
        <Pressable accessibilityLabel={`Back to ${backLabel}`} accessibilityRole="button" onPress={onBack} style={styles.gameDetailsBack}>
          <Ionicons name="arrow-back" size={19} color={colors.ink} />
          <Text style={styles.gameDetailsBackText}>{backLabel}</Text>
        </Pressable>
        <View style={styles.gameDetailsLivePill}>
          <View style={[styles.liveDot, !hasRunningTable(item.game) && styles.liveDotWarm]} />
          <Text style={styles.gameDetailsLiveText}>{getGameStatusLabel(item.game)}</Text>
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
          <Text style={styles.gameDetailsLocation}>{[getClubCity(item.club), item.distanceMiles == null ? null : `${item.distanceMiles.toFixed(1)} mi away`].filter(Boolean).join(' · ')}</Text>
        </View>
      </LinearGradient>

      <View style={styles.detailsQuickSummary}>
        <Text style={styles.detailsQuickValue}>{getPublishedAvailabilityLabel(item.game)}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{fee.label}</Text>
        <Text style={styles.detailsQuickDivider}>|</Text>
        <Text style={styles.detailsQuickValue}>{getPublishedTableSummary(item.game)}</Text>
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
          <DetailRow icon="people-outline" label="Seats" value={getPublishedAvailabilityLabel(item.game)} />
          <DetailRow icon="layers-outline" label="Tables" value={getPublishedTableSummary(item.game)} />
          <DetailRow icon="receipt-outline" label="Collection" value={fee.label} />
          <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Address not published'} />
        </View>
      </View>

      <View style={styles.notificationPromise}>
        <View style={styles.notificationPromiseIcon}>
          <Ionicons name="notifications-outline" size={19} color={colors.primary} />
        </View>
        <View style={styles.notificationPromiseCopy}>
          <Text style={styles.cardTitle}>In-app venue updates</Text>
          <Text style={styles.muted}>Eligible updates sent by this venue can appear inside Orbit after you join.</Text>
        </View>
      </View>

      {item.seatRequestAccess !== 'active' ? (
        <Pressable onPress={item.seatRequestAccess === 'pending' ? onJoin : onViewStore} style={styles.storeButton}>
          <Ionicons name="storefront-outline" size={18} color={colors.primary} />
          <View style={styles.storeButtonCopy}>
            <Text style={styles.storeButtonText}>{accessOptionCopy.title}</Text>
            <Text style={styles.muted}>{accessOptionCopy.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={colors.primary} />
        </Pressable>
      ) : null}

      <View style={styles.detailsActionRow}>
        {item.club.club.address?.trim() ? (
          <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} accessibilityRole="button" onPress={onDirections} style={styles.detailsSecondaryButton}>
            <Ionicons name="navigate-outline" size={18} color={colors.ink} />
            <Text style={styles.detailsSecondaryText}>Directions</Text>
          </Pressable>
        ) : null}
        <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
          <Ionicons name={item.seatRequestAccess === 'active' ? 'person-add-outline' : item.seatRequestAccess === 'pending' ? 'time-outline' : 'card-outline'} size={18} color="#ffffff" />
          <Text style={styles.primaryButtonText}>{getSeatRequestActionLabel(item.seatRequestAccess, runningTablePublished)}</Text>
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
  const runningTablePublished = hasRunningTable(item.game);
  const accessOptionCopy = getSeatAccessOptionCopy(item.seatRequestAccess, item.club.club.name);
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
                <Text style={styles.muted}>{[item.club.club.name, getClubCity(item.club), item.distanceMiles == null ? null : `${item.distanceMiles.toFixed(1)} mi`].filter(Boolean).join(' · ')}</Text>
              </View>
              <Pressable accessibilityLabel="Close game details" accessibilityRole="button" onPress={onClose} style={styles.modalCloseButton}>
                <Ionicons name="close" size={20} color={colors.ink} />
              </Pressable>
            </View>

            <View style={styles.detailsQuickSummary}>
              <Text style={styles.detailsQuickValue}>{getPublishedAvailabilityLabel(item.game)}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{fee.label}</Text>
              <Text style={styles.detailsQuickDivider}>|</Text>
              <Text style={styles.detailsQuickValue}>{item.distanceMiles == null ? 'Distance unavailable' : `${item.distanceMiles.toFixed(1)} mi`}</Text>
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
                  <DetailRow icon="heart-outline" label="Preferences" value={item.isPreferred ? 'Saved game preference' : 'Published room listing'} />
                  <DetailRow icon="people-outline" label="Availability" value={getPublishedAvailabilityLabel(item.game)} />
                  <DetailRow icon="person-outline" label="Familiar players" value={`${item.game.knownPlayersCount || 0} listed`} />
                  <DetailRow icon="navigate-outline" label="Distance" value={item.distanceMiles == null ? 'Unavailable' : `${item.distanceMiles.toFixed(1)} mi away`} />
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
                  <DetailRow icon="people-outline" label="Seats" value={getPublishedAvailabilityLabel(item.game)} />
                  <DetailRow icon="layers-outline" label="Tables" value={getPublishedTableSummary(item.game)} />
                  <DetailRow icon="receipt-outline" label="Collection" value={fee.label} />
                  <DetailRow icon="location-outline" label="Location" value={item.club.club.address ?? 'Address not published'} />
                </View>
              ) : null}
            </View>

            <View style={styles.notificationPromise}>
              <View style={styles.notificationPromiseIcon}>
                <Ionicons name="notifications-outline" size={19} color={colors.primary} />
              </View>
              <View style={styles.notificationPromiseCopy}>
                <Text style={styles.cardTitle}>In-app venue updates</Text>
                <Text style={styles.muted}>Eligible updates sent by this venue can appear inside Orbit after you join.</Text>
              </View>
            </View>

            {item.seatRequestAccess !== 'active' ? (
              <Pressable onPress={item.seatRequestAccess === 'pending' ? onJoin : onViewStore} style={styles.storeButton}>
                <Ionicons name="storefront-outline" size={18} color={colors.primary} />
                <View style={styles.storeButtonCopy}>
                  <Text style={styles.storeButtonText}>{accessOptionCopy.title}</Text>
                  <Text style={styles.muted}>{accessOptionCopy.body}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.primary} />
              </Pressable>
            ) : null}

            <View style={styles.detailsActionRow}>
              {item.club.club.address?.trim() ? (
                <Pressable accessibilityLabel={`Directions to ${item.club.club.name}`} accessibilityRole="button" onPress={onDirections} style={styles.detailsSecondaryButton}>
                  <Ionicons name="navigate-outline" size={18} color={colors.ink} />
                  <Text style={styles.detailsSecondaryText}>Directions</Text>
                </Pressable>
              ) : null}
              <AnimatedButton variant="primary" onPress={onJoin} style={[styles.primaryButton, styles.detailsPrimaryButton]}>
                <Ionicons name={item.seatRequestAccess === 'active' ? 'person-add-outline' : item.seatRequestAccess === 'pending' ? 'time-outline' : 'card-outline'} size={18} color="#ffffff" />
                <Text style={styles.primaryButtonText}>{getSeatRequestActionLabel(item.seatRequestAccess, runningTablePublished)}</Text>
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
