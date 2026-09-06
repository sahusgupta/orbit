import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getPlayerGameStatusLabel,
  getWaitlistAheadText,
  type PlayerClubSnapshot,
  type PlayerSyncGame,
  type PlayerWaitlistEntry
} from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function MyGamesSection({ games, message = '', readOnly = false, onCancel }: {
  games: Array<{ club: PlayerClubSnapshot; game: PlayerSyncGame; entry: PlayerWaitlistEntry }>;
  message?: string;
  readOnly?: boolean;
  onCancel: (club: PlayerClubSnapshot, game: PlayerSyncGame, entry: PlayerWaitlistEntry) => void;
}) {
  if (!games.length) return null;
  return (
    <View style={styles.myGamesSection}>
      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionTitle}>My Games</Text>
          <Text style={styles.muted}>Venue-reported requests and seats</Text>
        </View>
        <View style={styles.myGamesCount}>
          <Text style={styles.myGamesCountText}>{games.length}</Text>
        </View>
      </View>
      {readOnly ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.muted}>Requests are read-only until published venue data refreshes.</Text>
        </View>
      ) : null}
      {message ? <Text accessibilityRole="alert" style={styles.formError}>{message}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.myGamesRail}>
        {games.map(({ club, game, entry }) => {
          const canCancel = ['Interested', 'Confirmed Coming', 'Arrived'].includes(entry.status);
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
              {canCancel ? (
                <View style={styles.myGameActions}>
                  <Pressable
                    accessibilityLabel={`Cancel request for ${game.name}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: readOnly }}
                    disabled={readOnly}
                    onPress={() => onCancel(club, game, entry)}
                    style={styles.myGameSecondaryAction}
                  >
                    <Text style={styles.myGameSecondaryActionText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
