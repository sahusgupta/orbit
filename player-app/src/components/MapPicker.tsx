import { Platform, Text, View } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from './MapView';
import { homeCoordinate } from '../domain/discovery';
import { sharedStyles as styles } from '../styles/sharedStyles';
import { colors } from '../styles/playerTheme';

export function MapPicker({
  locationLabel,
  radiusMiles,
  onSelectLocation
}: {
  locationLabel: string;
  radiusMiles: number;
  onSelectLocation: (location: string) => void;
}) {
  const region = {
    latitude: homeCoordinate.latitude,
    longitude: homeCoordinate.longitude,
    latitudeDelta: radiusMiles >= 50 ? 0.55 : radiusMiles >= 25 ? 0.28 : 0.14,
    longitudeDelta: radiusMiles >= 50 ? 0.55 : radiusMiles >= 25 ? 0.28 : 0.14
  };

  return (
    <View style={styles.mapCard}>
      <View style={styles.mapCanvas}>
        <MapView
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          style={styles.liveMap}
          initialRegion={region}
          onPress={(event) => {
            const { latitude, longitude } = event.nativeEvent.coordinate;
            onSelectLocation(`${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
          }}
        >
          <Circle
            center={homeCoordinate}
            radius={radiusMiles * 1609.34}
            strokeColor="rgba(56,80,109,0.35)"
            fillColor="rgba(56,80,109,0.08)"
          />
          <Marker coordinate={homeCoordinate} title="Home area" description={locationLabel} pinColor={colors.primary} />
          <Marker coordinate={{ latitude: 30.674, longitude: -96.37 }} title="Bryan, TX" onPress={() => onSelectLocation('Bryan, TX')} pinColor={colors.amber} />
          <Marker coordinate={{ latitude: 30.58, longitude: -96.29 }} title="South College Station" onPress={() => onSelectLocation('South College Station, TX')} pinColor={colors.teal} />
        </MapView>
      </View>
      <View style={styles.mapFooter}>
        <Text style={styles.cardTitle}>{locationLabel}</Text>
        <Text style={styles.muted}>Tap the map, choose a pin, or type your area below.</Text>
      </View>
    </View>
  );
}

