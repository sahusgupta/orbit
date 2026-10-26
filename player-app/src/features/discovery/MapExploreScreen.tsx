import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from '../../components/MapView';
import { IconActionButton, SearchToolbar } from '../../components/PlayerPresentation';
import { getClubAvailabilityLabel, getClubCoordinate } from '../../domain/discovery';
import { searchMapClubs } from '../../domain/mapSearch';
import { getPublishedMapRegion } from '../../domain/publishedMapRegion';
import type { PlayerClubSnapshot } from '../../domain/playerSync';
import { sharedStyles } from '../../styles/sharedStyles';
import { discoveryStyles } from './discoveryStyles';

const baseStyles = { ...sharedStyles, ...discoveryStyles };

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
  const styles = useThemedStyles(baseStyles);
  const { colors, scheme } = usePlayerTheme();
  const visibleClubs = searchMapClubs(clubs, query);
  const publishedPins = visibleClubs.flatMap((club) => {
    const coordinate = getClubCoordinate(club);
    return coordinate ? [{ club, coordinate }] : [];
  });
  const mapRegion = getPublishedMapRegion(publishedPins.map(({ coordinate }) => coordinate));
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
        placeholder="City, address, venue, or game"
        filterLabel="map"
        onOpenFilters={onOpenFilters}
      />
      <View style={styles.mapCard}>
        {mapRegion ? (
          <View style={styles.mapCanvasLarge}>
            <MapView
              key={JSON.stringify(mapRegion)}
              provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
              userInterfaceStyle={scheme}
              style={styles.liveMap}
              initialRegion={mapRegion}
              showsUserLocation={false}
              showsMyLocationButton={false}
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
            <Text style={styles.cardTitle}>{visibleClubs.length ? 'No venue coordinates published' : 'No matching venue locations'}</Text>
            <Text style={styles.muted}>{visibleClubs.length ? 'Venues without a published map pin are listed below.' : 'Try a published city, address, venue, or game.'}</Text>
          </View>
        )}
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Venue results</Text>
        <Text style={styles.muted}>{visibleClubs.length} places</Text>
      </View>
      {visibleClubs.length ? visibleClubs.map((club) => {
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
              {!readOnly && (club.club.address?.trim() || getClubCoordinate(club)) ? (
                <IconActionButton icon="navigate-outline" label={`${Platform.OS === 'ios' ? 'Apple Maps directions' : 'Directions'} to ${club.club.name}`} onPress={() => onDirections(club)} />
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
          <Text style={styles.muted}>Try a published city, address, venue, or game.</Text>
        </View>
      )}
    </>
  );
}
