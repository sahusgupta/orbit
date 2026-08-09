import { Platform, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from '../../components/MapView';
import { IconActionButton, SearchToolbar } from '../../components/PlayerPresentation';
import { getClubCoordinate } from '../../domain/discovery';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

const texasMapRegion = {
  latitude: 31.75,
  longitude: -96.75,
  latitudeDelta: 5,
  longitudeDelta: 5.4
};

export function MapExploreScreen({
  clubs,
  originCoordinate,
  query,
  setQuery,
  onOpenFilters,
  onDirections,
  onShowGames
}: {
  clubs: PlayerClubSnapshot[];
  originCoordinate: { latitude: number; longitude: number };
  query: string;
  setQuery: (value: string) => void;
  onOpenFilters: () => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onShowGames: (club: PlayerClubSnapshot) => void;
}) {
  return (
    <>
      <SearchToolbar
        value={query}
        onChangeText={setQuery}
        placeholder="Search card houses, areas, or games"
        filterLabel="map"
        onOpenFilters={onOpenFilters}
      />
      <View style={styles.mapCard}>
        <View style={styles.mapCanvasLarge}>
          <MapView
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            style={styles.liveMap}
            initialRegion={texasMapRegion}
          >
            <Circle
              center={originCoordinate}
              radius={20 * 1609.34}
              strokeColor="rgba(56,80,109,0.26)"
              fillColor="rgba(56,80,109,0.06)"
            />
            {clubs.map((club) => (
              <Marker
                key={club.club.id}
                coordinate={getClubCoordinate(club)}
                title={club.club.name}
                description={club.club.address}
                onPress={() => onShowGames(club)}
                pinColor={club.memberships.length ? colors.teal : colors.primary}
              />
            ))}
          </MapView>
        </View>
        <View style={styles.mapFooter}>
          <Text style={styles.cardTitle}>Explore card houses</Text>
          <Text style={styles.muted}>Drag the map, tap a pin, or search by location and game.</Text>
        </View>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Map Results</Text>
        <Text style={styles.muted}>{clubs.length} places</Text>
      </View>
      {clubs.length ? clubs.map((club) => {
        const openSeats = club.games.reduce((sum, game) => sum + game.availableSeats, 0);
        return (
          <View key={club.club.id} style={styles.clubCard}>
            <View style={styles.clubAvatar}>
              <Text style={styles.clubAvatarText}>{club.club.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.clubMain}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{club.club.address ?? 'Address not published'} - {openSeats} open seats</Text>
            </View>
            <View style={styles.iconActionRow}>
              <IconActionButton icon="navigate-outline" label={`Directions to ${club.club.name}`} onPress={() => onDirections(club)} />
              <IconActionButton icon="list-outline" label={`View games at ${club.club.name}`} onPress={() => onShowGames(club)} />
            </View>
          </View>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No map results</Text>
          <Text style={styles.muted}>Try searching by card house, area, address, or game name.</Text>
        </View>
      )}
    </>
  );
}
