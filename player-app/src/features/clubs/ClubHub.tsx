import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MapPicker } from '../../components/MapPicker';
import { AnimatedSurface, IconActionButton } from '../../components/PlayerPresentation';
import { getClubDistance, getGameStatusLabel, isActivePlayerGame } from '../../domain/discovery';
import {
  formatPassCountdown,
  getPlayerGameStatusLabel,
  isMembershipCurrentlyActive,
  type PlayerClubSnapshot,
  type PlayerSyncGame,
  type PlayerTournament,
  type PlayerWaitlistEntry
} from '../../domain/playerSync';
import { formatEventDate } from '../tournaments/TournamentScreen';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { clubStyles } from './clubStyles';

const styles = { ...sharedStyles, ...clubStyles };

export function NearbyCheckInPanel({
  clubs,
  checkedInClubIds,
  onCheckIn,
  onDirections
}: {
  clubs: PlayerClubSnapshot[];
  checkedInClubIds: Set<string>;
  onCheckIn: (club: PlayerClubSnapshot) => void;
  onDirections: (club: PlayerClubSnapshot) => void;
}) {
  const nearbyClubs = clubs.slice().sort((left, right) => getClubDistance(left) - getClubDistance(right));
  return (
    <>
      <MapPicker
        locationLabel="Clubs near you"
        radiusMiles={20}
        onSelectLocation={() => undefined}
      />
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Nearest clubs</Text>
        <Text style={styles.muted}>Within 20 mi</Text>
      </View>
      {nearbyClubs.length ? nearbyClubs.map((club) => {
        const checkedIn = checkedInClubIds.has(club.club.id);
        const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
        return (
          <AnimatedSurface key={club.club.id} style={[styles.clubCard, checkedIn && styles.selectedCard]}>
            <View style={[styles.clubAvatar, checkedIn && styles.clubAvatarActive]}>
              <Text style={[styles.clubAvatarText, checkedIn && styles.clubAvatarTextActive]}>{club.club.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.clubMain}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{getClubDistance(club).toFixed(1)} mi / {openSeats} seats / {club.social?.activePlayerCount ?? 0} players</Text>
            </View>
            <View style={styles.iconActionRow}>
              <IconActionButton icon="navigate-outline" label={`Directions to ${club.club.name}`} onPress={() => onDirections(club)} />
              <IconActionButton icon={checkedIn ? 'checkmark-circle' : 'enter-outline'} label={`Check in to ${club.club.name}`} onPress={() => onCheckIn(club)} active={checkedIn} />
            </View>
          </AnimatedSurface>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No clubs nearby</Text>
          <Text style={styles.muted}>Published clubs will appear here when they are within your check-in area.</Text>
        </View>
      )}
    </>
  );
}

export function ClubHubSections({
  club: _club,
  membership,
  games,
  waitlists,
  tournaments,
  nowMs,
  onGame,
  onManageAccess,
  onViewEvents
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  games: PlayerSyncGame[];
  waitlists: PlayerWaitlistEntry[];
  tournaments: PlayerTournament[];
  nowMs: number;
  onGame: (game: PlayerSyncGame) => void;
  onManageAccess: () => void;
  onViewEvents: () => void;
}) {
  const [openSection, setOpenSection] = useState<'games' | 'membership' | 'events' | null>(null);
  const toggle = (section: 'games' | 'membership' | 'events') => setOpenSection((current) => current === section ? null : section);
  const activeGames = games.filter(isActivePlayerGame);
  const requestableGames = games.filter((game) => !isActivePlayerGame(game));
  return (
    <View style={styles.clubHub}>
      <Pressable onPress={() => toggle('games')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="layers-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Games</Text>
          <Text style={styles.muted}>{activeGames.length} active · {requestableGames.length} requestable</Text>
        </View>
        <Ionicons name={openSection === 'games' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'games' ? (
        <View style={styles.clubHubPanel}>
          {activeGames.length ? <Text style={styles.clubGameGroupLabel}>ACTIVE NOW</Text> : null}
          {activeGames.map((game) => {
            const waitlist = waitlists.find((entry) => entry.gameId === game.id);
            return (
              <Pressable key={game.id} disabled={Boolean(waitlist)} onPress={() => onGame(game)} style={styles.compactGameRow}>
                <View style={styles.compactGameCopy}>
                  <Text style={styles.cardTitle}>{game.name}</Text>
                  <Text style={styles.muted}>{getGameStatusLabel(game)}</Text>
                </View>
                <Text style={[styles.compactGameAction, waitlist && styles.compactGameActionMuted]}>
                  {waitlist ? getPlayerGameStatusLabel(waitlist) : 'Join game'}
                </Text>
              </Pressable>
            );
          })}
          {requestableGames.length ? (
            <>
              <View style={styles.clubRequestHeader}>
                <Text style={styles.clubGameGroupLabel}>REQUEST ANOTHER GAME</Text>
                <Text style={styles.muted}>Your interest helps the card house decide what to open.</Text>
              </View>
              {requestableGames.map((game) => {
                const request = waitlists.find((entry) => entry.gameId === game.id);
                return (
                  <Pressable key={game.id} disabled={Boolean(request)} onPress={() => onGame(game)} style={[styles.compactGameRow, styles.requestGameRow]}>
                    <View style={styles.compactGameCopy}>
                      <Text style={styles.cardTitle}>{game.name}</Text>
                      <Text style={styles.muted}>
                        {game.waitlistCount
                          ? `${game.waitlistCount} player${game.waitlistCount === 1 ? '' : 's'} interested`
                          : 'No active table · Be the first to request it'}
                      </Text>
                    </View>
                    <Text style={[styles.compactGameAction, request && styles.compactGameActionMuted]}>
                      {request ? 'Requested' : 'Request game'}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}
        </View>
      ) : null}

      <Pressable onPress={() => toggle('membership')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="card-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Membership</Text>
          <Text style={styles.muted}>{isMembershipCurrentlyActive(membership, nowMs) ? formatPassCountdown(membership.expiresAt, nowMs) : membership.status}</Text>
        </View>
        <Ionicons name={openSection === 'membership' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'membership' ? (
        <View style={styles.clubHubPanel}>
          <View style={styles.membershipCompactStats}>
            <View><Text style={styles.compactStatValue}>{membership.loyalty.points.toLocaleString()}</Text><Text style={styles.compactStatLabel}>Points</Text></View>
            <View><Text style={styles.compactStatValue}>{membership.loyalty.tier}</Text><Text style={styles.compactStatLabel}>Tier</Text></View>
            <View><Text style={styles.compactStatValue}>{membership.plan === 'day' ? 'Day' : 'Monthly'}</Text><Text style={styles.compactStatLabel}>Plan</Text></View>
          </View>
          <Pressable onPress={onManageAccess} style={styles.compactManageButton}>
            <Text style={styles.compactManageText}>Manage access</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable onPress={() => toggle('events')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="trophy-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Events</Text>
          <Text style={styles.muted}>{tournaments.length ? `${tournaments.length} upcoming` : 'None scheduled'}</Text>
        </View>
        <Ionicons name={openSection === 'events' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'events' ? (
        <View style={styles.clubHubPanel}>
          {tournaments.slice(0, 2).map((tournament) => (
            <View key={tournament.id} style={styles.compactEventRow}>
              <View style={styles.compactGameCopy}>
                <Text style={styles.cardTitle}>{tournament.name}</Text>
                <Text style={styles.muted}>{formatEventDate(tournament.startsAt)}</Text>
              </View>
            </View>
          ))}
          <Pressable onPress={onViewEvents} style={styles.compactManageButton}>
            <Text style={styles.compactManageText}>View events</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export function ClubMembershipPanel({
  club,
  membership,
  nowMs,
  onBuyPass
}: {
  club: PlayerClubSnapshot;
  membership: PlayerClubSnapshot['memberships'][number];
  nowMs: number;
  onBuyPass: () => void;
}) {
  const active = isMembershipCurrentlyActive(membership, nowMs);
  const requested = membership.status === 'Requested';
  const approved = membership.status === 'Approved';
  return (
    <View style={styles.loyaltyCard}>
      <View style={styles.loyaltyHeader}>
        <View>
          <Text style={styles.cardTitle}>Membership</Text>
          <Text style={styles.muted}>{membership.plan === 'day' ? 'Day pass' : 'Monthly membership'} · {requested ? 'Under review' : approved ? 'Approved' : active ? 'Active' : 'Expired'}</Text>
        </View>
        <View style={styles.loyaltyBadge}>
          <Text style={styles.loyaltyBadgeText}>{membership.loyalty.tier}</Text>
        </View>
      </View>
      <Text style={styles.points}>{membership.loyalty.points.toLocaleString()} pts</Text>
      <View style={[styles.passTimer, active ? styles.passTimerActive : styles.passTimerInactive]}>
        <Ionicons name={requested ? 'time-outline' : approved ? 'id-card-outline' : 'timer-outline'} size={18} color={active ? colors.teal : colors.ink} />
        <View style={styles.passTimerCopy}>
          <Text style={styles.passTimerTitle}>{requested
            ? 'Application under review'
            : approved
              ? 'Visit the front desk to activate'
            : active
              ? formatPassCountdown(membership.expiresAt, nowMs)
              : 'Pass expired, buy a new pass'}</Text>
          <Text style={styles.muted}>{requested
            ? 'The card room will approve or follow up on your application.'
            : approved
              ? 'Bring your ID and pay the membership fee. Staff will activate you at the door.'
            : membership.expiresAt
              ? `Ends ${new Date(membership.expiresAt).toLocaleString()}`
              : 'No active expiration time is set.'}</Text>
        </View>
      </View>
      <Text style={styles.muted}>{club.games.length} games available</Text>
      <Pressable style={styles.buyAnotherPassButton} onPress={onBuyPass}>
        <Text style={styles.buyAnotherPassText}>{active ? 'Buy another pass' : 'Choose a pass'}</Text>
      </Pressable>
    </View>
  );
}

export function ClubHistoryPanel() {
  return (
    <View style={styles.accountCard}>
      <Text style={styles.sectionTitle}>Prior Sessions</Text>
      <Text style={styles.muted}>Check-in and cash-out history will appear here.</Text>
      <Text style={styles.sectionTitle}>Scheduled Games</Text>
      <Text style={styles.muted}>No scheduled games posted yet.</Text>
    </View>
  );
}
