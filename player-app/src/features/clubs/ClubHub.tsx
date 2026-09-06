import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedSurface, IconActionButton } from '../../components/PlayerPresentation';
import { getGameStatusLabel, hasRunningTable, isActivePlayerGame, isUpcomingTournament } from '../../domain/discovery';
import {
  formatPassCountdown,
  getPlayerGameStatusLabel,
  getPublishedMembershipPlanLabel,
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
  const openOrFormingGames = games.filter(isActivePlayerGame);
  const otherPublishedGames = games.filter((game) => !isActivePlayerGame(game));
  const upcomingTournaments = tournaments.filter((tournament) => isUpcomingTournament(tournament, nowMs));
  return (
    <View style={styles.clubHub}>
      <Pressable accessibilityLabel="Games" accessibilityRole="button" accessibilityState={{ expanded: openSection === 'games' }} onPress={() => toggle('games')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="layers-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Games</Text>
          <Text style={styles.muted}>{openOrFormingGames.length} open or forming · {otherPublishedGames.length} other published</Text>
        </View>
        <Ionicons name={openSection === 'games' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'games' ? (
        <View style={styles.clubHubPanel}>
          {openOrFormingGames.length ? <Text style={styles.clubGameGroupLabel}>OPEN OR FORMING</Text> : null}
          {openOrFormingGames.map((game) => {
            const waitlist = waitlists.find((entry) => entry.gameId === game.id);
            return (
              <Pressable key={game.id} disabled={Boolean(waitlist)} onPress={() => onGame(game)} style={styles.compactGameRow}>
                <View style={styles.compactGameCopy}>
                  <Text style={styles.cardTitle}>{game.name}</Text>
                  <Text style={styles.muted}>{getGameStatusLabel(game)}</Text>
                </View>
                <Text style={[styles.compactGameAction, waitlist && styles.compactGameActionMuted]}>
                  {waitlist ? getPlayerGameStatusLabel(waitlist) : hasRunningTable(game) ? 'Request seat' : 'Send interest'}
                </Text>
              </Pressable>
            );
          })}
          {otherPublishedGames.length ? (
            <>
              <View style={styles.clubRequestHeader}>
                <Text style={styles.clubGameGroupLabel}>REQUEST ANOTHER GAME</Text>
                <Text style={styles.muted}>Your interest helps the venue decide what to open.</Text>
              </View>
              {otherPublishedGames.map((game) => {
                const request = waitlists.find((entry) => entry.gameId === game.id);
                return (
                  <Pressable key={game.id} disabled={Boolean(request)} onPress={() => onGame(game)} style={[styles.compactGameRow, styles.requestGameRow]}>
                    <View style={styles.compactGameCopy}>
                      <Text style={styles.cardTitle}>{game.name}</Text>
                      <Text style={styles.muted}>
                        {game.waitlistCount
                          ? `${game.waitlistCount} player${game.waitlistCount === 1 ? '' : 's'} interested`
                          : 'No open table published · Send interest'}
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

      <Pressable accessibilityLabel="Membership" accessibilityRole="button" accessibilityState={{ expanded: openSection === 'membership' }} onPress={() => toggle('membership')} style={styles.clubHubRow}>
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
            <View><Text style={styles.compactStatValue}>{getPublishedMembershipPlanLabel(membership)}</Text><Text style={styles.compactStatLabel}>Published option</Text></View>
          </View>
          <Pressable onPress={onManageAccess} style={styles.compactManageButton}>
            <Text style={styles.compactManageText}>Manage access</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable accessibilityLabel="Events" accessibilityRole="button" accessibilityState={{ expanded: openSection === 'events' }} onPress={() => toggle('events')} style={styles.clubHubRow}>
        <View style={styles.clubHubIcon}><Ionicons name="trophy-outline" size={19} color={colors.primary} /></View>
        <View style={styles.clubHubCopy}>
          <Text style={styles.cardTitle}>Events</Text>
          <Text style={styles.muted}>{upcomingTournaments.length ? `${upcomingTournaments.length} upcoming` : 'None upcoming'}</Text>
        </View>
        <Ionicons name={openSection === 'events' ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
      </Pressable>
      {openSection === 'events' ? (
        <View style={styles.clubHubPanel}>
          {upcomingTournaments.slice(0, 2).map((tournament) => (
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

export function PlayerTimePanel({
  club,
  message
}: {
  club: PlayerClubSnapshot;
  message: string;
}) {
  const access = club.timeAccess;
  if (!access?.enabled || !access.linked) return null;
  const session = access.activeSession;
  return (
    <View style={styles.accountCard}>
      <View style={styles.membershipWalletTop}>
        <View>
          <Text style={styles.sectionTitle}>Table time</Text>
          <Text style={styles.muted}>{session
            ? `${session.gameName} · ${session.tableLabel}`
            : 'Your Core profile is linked, but you are not seated at a time-fee table.'}</Text>
        </View>
        {session ? <View style={styles.statusPill}><Text style={styles.statusText}>{session.remainingMinutes} min left</Text></View> : null}
      </View>
      {access.savedMinutes > 0 ? <Text style={styles.muted}>{access.savedMinutes} saved minutes are also on your Core profile.</Text> : null}
      {session ? <Text style={styles.muted}>Time balances are managed by venue staff. Orbit does not sell time packages in this release.</Text> : null}
      {message ? <Text style={styles.actionStatus}>{message}</Text> : null}
    </View>
  );
}
