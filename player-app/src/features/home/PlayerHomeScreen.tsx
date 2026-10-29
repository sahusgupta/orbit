import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getClubCity, getGameStatusLabel } from '../../domain/discovery';
import type { GameOpportunity } from '../../domain/playerTypes';
import { colors } from '../../styles/playerTheme';
import { playerHomeStyles as baseStyles } from './playerHomeStyles';

type PlayerHomeScreenProps = {
  opportunities: GameOpportunity[];
  inventoryPartial: boolean;
  inventoryStatus: 'idle' | 'loading' | 'ready' | 'error';
  openTournamentCount: number | null;
  clubCount: number;
  onFindGame: () => void;
  onOpenGame: (item: GameOpportunity) => void;
  onBrowseTournaments: () => void;
  onBrowseClubs: () => void;
};

export function PlayerHomeScreen({
  opportunities,
  inventoryPartial,
  inventoryStatus,
  openTournamentCount,
  clubCount,
  onFindGame,
  onOpenGame,
  onBrowseTournaments,
  onBrowseClubs
}: PlayerHomeScreenProps) {
  const styles = useThemedStyles(baseStyles);
  const { colors } = usePlayerTheme();
  const games = opportunities.slice(0, 3);
  const inventoryReady = inventoryStatus === 'ready' && !inventoryPartial;
  const eventCountReady = inventoryReady && openTournamentCount !== null;
  const loading = inventoryStatus === 'idle' || inventoryStatus === 'loading';
  let emptyCopy = 'No games to show right now.';
  if (inventoryStatus === 'error') emptyCopy = 'Game data is unavailable.';
  else if (inventoryPartial) emptyCopy = 'No games in the venues loaded so far.';
  else if (loading) emptyCopy = 'Loading games…';

  return (
    <View style={styles.home}>
      <Pressable
        accessibilityLabel="Find games"
        accessibilityRole="button"
        onPress={onFindGame}
        style={({ pressed }) => [styles.findGames, pressed && styles.pressed]}
      >
        <Ionicons color={colors.ink} name="search-outline" size={20} />
        <Text style={styles.findGamesText}>Find games</Text>
        <Ionicons color={colors.muted} name="chevron-forward" size={18} />
      </Pressable>

      <View style={styles.section}>
        {games.length && (inventoryStatus === 'error' || loading || inventoryPartial) ? <View style={styles.sectionHeading}>
          {inventoryStatus === 'error' ? <Text accessibilityRole="header" style={styles.sectionTitle}>Last loaded games</Text> : null}
          {games.length && inventoryStatus !== 'error' && (loading || inventoryPartial) ? (
            <Text accessibilityLiveRegion="polite" style={styles.statusNote}>{loading ? 'Updating…' : 'Showing loaded venues'}</Text>
          ) : null}
        </View> : null}
        {games.length ? (
          <View style={styles.gameList}>
            {games.map((item, index) => {
              const city = getClubCity(item.club);
              const status = getGameStatusLabel(item.game);
              return (
                <Pressable
                  key={`${item.club.club.id}:${item.game.id}`}
                  accessibilityLabel={`Open ${item.game.name} at ${item.club.club.name}, ${city}. ${inventoryStatus === 'error' ? `Last loaded: ${status}` : status}`}
                  accessibilityRole="button"
                  onPress={() => onOpenGame(item)}
                  style={({ pressed }) => [styles.gameRow, index > 0 && styles.rowDivider, pressed && styles.pressed]}
                >
                  <View style={styles.gameVisual}>
                    <Ionicons color={colors.teal} name="layers-outline" size={26} />
                  </View>
                  <View style={styles.gameCopy}>
                    <Text numberOfLines={1} style={styles.gameName}>{item.game.name}</Text>
                    <Text numberOfLines={1} style={styles.venue}>{item.club.club.name} · {city}</Text>
                    <Text style={styles.availability}>{status}</Text>
                  </View>
                  <Ionicons color={colors.muted} name="chevron-forward" size={18} />
                </Pressable>
              );
            })}
          </View>
        ) : (
          <View
            accessibilityLiveRegion="polite"
            accessibilityRole={loading && !inventoryPartial ? 'progressbar' : undefined}
            accessibilityLabel={loading && !inventoryPartial ? 'Loading games' : undefined}
            style={styles.emptyState}
          >
            <Text style={styles.emptyText}>{emptyCopy}</Text>
          </View>
        )}
      </View>

      <View style={styles.shortcuts}>
        <Pressable
          accessibilityLabel={eventCountReady ? `Browse events, ${openTournamentCount} open` : 'Browse events'}
          accessibilityRole="button"
          onPress={onBrowseTournaments}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
        >
          <Ionicons color={colors.muted} name="calendar-outline" size={20} />
          <Text style={styles.shortcutText}>Events</Text>
          {eventCountReady ? <Text style={styles.shortcutCount}>{openTournamentCount}</Text> : null}
        </Pressable>
        <Pressable
          accessibilityLabel={inventoryReady ? `Browse clubs, ${clubCount} clubs` : 'Browse clubs'}
          accessibilityRole="button"
          onPress={onBrowseClubs}
          style={({ pressed }) => [styles.shortcut, pressed && styles.pressed]}
        >
          <Ionicons color={colors.muted} name="people-outline" size={20} />
          <Text style={styles.shortcutText}>Clubs</Text>
          {inventoryReady ? <Text style={styles.shortcutCount}>{clubCount}</Text> : null}
        </Pressable>
      </View>
    </View>
  );
}
