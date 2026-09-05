import { Platform, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from '../../components/MapView';
import { IconActionButton, SearchToolbar } from '../../components/PlayerPresentation';
import { getClubAvailabilityLabel, getClubCoordinate } from '../../domain/discovery';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { colors } from '../../styles/playerTheme';
import { discoveryStyles } from './discoveryStyles';

const styles = { ...sharedStyles, ...discoveryStyles };

export function getMapClubPrimaryAction(club: PlayerClubSnapshot): 'games' | 'membership' | null {
  if (club.games.length) return 'games';
  if (club.club.membershipOptions?.length) return 'membership';
  return null;
}

export function MapExploreScreen({ clubs, query, readOnly, setQuery, onOpenFilters, onDirections, onShowGames, onRequestAccess }: {
  clubs: PlayerClubSnapshot[];
  query: string;
  readOnly: boolean;
  setQuery: (value: string) => void;
  onOpenFilters: () => void;
  onDirections: (club: PlayerClubSnapshot) => void;
  onShowGames: (club: PlayerClubSnapshot) => void;
  onRequestAccess: (club: PlayerClubSnapshot) => void;
}) {
  const publishedPins = clubs.flatMap((club) => {
    const coordinate = getClubCoordinate(club);
    return coordinate ? [{ club, coordinate }] : [];
  });
  const firstCoordinate = publishedPins[0]?.coordinate;
  return (
    <>
      {readOnly && clubs.length ? (
        <View accessibilityRole="alert" style={styles.emptyState}>
          <Text style={styles.cardTitle}>Showing previously loaded venues</Text>
          <Text style={styles.muted}>Map listings are read-only until Orbit refreshes the current venue catalog.</Text>
        </View>
      ) : null}
      <SearchToolbar
        value={query}
        onChangeText={setQuery}
        placeholder="Search venues, addresses, or games"
        filterLabel="map"
        onOpenFilters={onOpenFilters}
      />
      <View style={styles.mapCard}>
        {firstCoordinate ? (
          <View style={styles.mapCanvasLarge}>
            <MapView
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              style={styles.liveMap}
              initialRegion={{ ...firstCoordinate, latitudeDelta: 0.25, longitudeDelta: 0.25 }}
            >
              {publishedPins.map(({ club, coordinate }) => {
                const primaryAction = getMapClubPrimaryAction(club);
                return (
                  <Marker
                    key={club.club.id}
                    coordinate={coordinate}
                    title={club.club.name}
                    description={club.club.address}
                    onPress={readOnly ? undefined : primaryAction === 'membership'
                      ? () => onRequestAccess(club)
                      : primaryAction === 'games' ? () => onShowGames(club) : undefined}
                    pinColor={club.memberships.length ? colors.teal : colors.primary}
                  />
                );
              })}
            </MapView>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.cardTitle}>No venue coordinates published</Text>
            <Text style={styles.muted}>Map pins appear only when a venue publishes validated coordinates. The venue list remains available below.</Text>
          </View>
        )}
        <View style={styles.mapFooter}>
          <Text style={styles.cardTitle}>Explore published venues</Text>
          <Text style={styles.muted}>Pins show venue-published coordinates only. Select a venue to see its games or published access options.</Text>
        </View>
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Venue results</Text>
        <Text style={styles.muted}>{clubs.length} places</Text>
      </View>
      {clubs.length ? clubs.map((club) => {
        const availability = getClubAvailabilityLabel(club);
        const primaryAction = getMapClubPrimaryAction(club);
        return (
          <View key={club.club.id} style={styles.clubCard}>
            <View style={styles.clubAvatar}>
              <Text style={styles.clubAvatarText}>{club.club.name.slice(0, 1)}</Text>
            </View>
            <View style={styles.clubMain}>
              <Text style={styles.cardTitle}>{club.club.name}</Text>
              <Text style={styles.muted}>{club.club.address ?? 'Address not published'} - {availability}</Text>
            </View>
            <View style={styles.iconActionRow}>
              {!readOnly && club.club.address?.trim() ? (
                <IconActionButton icon="navigate-outline" label={`Directions to ${club.club.name}`} onPress={() => onDirections(club)} />
              ) : null}
              {!readOnly && primaryAction === 'games' ? (
                <IconActionButton icon="list-outline" label={`View games at ${club.club.name}`} onPress={() => onShowGames(club)} />
              ) : !readOnly && primaryAction === 'membership' ? (
                <IconActionButton icon="card-outline" label={`Request access at ${club.club.name}`} onPress={() => onRequestAccess(club)} />
              ) : null}
            </View>
          </View>
        );
      }) : (
        <View style={styles.emptyState}>
          <Text style={styles.cardTitle}>No venue results</Text>
          <Text style={styles.muted}>Try searching by venue, published address, or game name.</Text>
        </View>
      )}
    </>
  );
}
