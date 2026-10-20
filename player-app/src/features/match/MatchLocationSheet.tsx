import { usePlayerTheme, useThemedStyles } from '../../styles/PlayerThemeProvider';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from '../../components/MapView';
import { FiltersBottomSheet } from '../../components/PlayerPresentation';
import { getClubCoordinate, isValidCoordinate } from '../../domain/discovery';
import { getPublishedMapRegion } from '../../domain/publishedMapRegion';
import type { PlayerClubSnapshot, PlayerCoordinate } from '../../domain/playerSync';
import type { usePlayerLocation } from '../../application/usePlayerLocation';
import { orbitMatchStyles as baseStyles } from './orbitMatchStyles';

export function MatchLocationSheet({ visible, onClose, controller, clubs, demoMode = false }: {
  visible: boolean; onClose: () => void; controller: ReturnType<typeof usePlayerLocation>; clubs: PlayerClubSnapshot[]; demoMode?: boolean;
}) {
  const styles = useThemedStyles(baseStyles);
  const { scheme } = usePlayerTheme();
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [selected, setSelected] = useState<PlayerCoordinate | null>(null);
  const [error, setError] = useState('');
  const [showMap, setShowMap] = useState(false);
  useEffect(() => { if (visible) { setLatitude(''); setLongitude(''); setSelected(null); setError(''); setShowMap(false); } }, [visible]);
  const region = getPublishedMapRegion(clubs.flatMap((club) => { const coordinate = getClubCoordinate(club); return coordinate ? [coordinate] : []; }))
    ?? { latitude: 0, longitude: 0, latitudeDelta: 120, longitudeDelta: 240 };
  const choose = (coordinate: PlayerCoordinate) => {
    if (!isValidCoordinate(coordinate)) return;
    setSelected(coordinate); setLatitude(String(coordinate.latitude)); setLongitude(String(coordinate.longitude)); setError('');
  };
  const saveManual = async () => {
    if (!latitude.trim() || !longitude.trim()) { setError('Enter both coordinates or select a point on the map.'); return; }
    const coordinate = { latitude: Number(latitude), longitude: Number(longitude) };
    if (!isValidCoordinate(coordinate)) { setError('Latitude must be -90 to 90 and longitude -180 to 180.'); return; }
    setError('');
    if (await controller.selectManual(coordinate)) onClose();
  };
  return (
    <FiltersBottomSheet visible={visible} title="Search location" onClose={onClose}>
      <Text style={styles.copy}>Choose where to search. This location is saved on this device and is not sent to Orbit.</Text>
      {controller.originLabel ? <Text style={styles.label}>Current: {controller.originLabel}</Text> : null}
      {controller.error || error ? <Text accessibilityRole="alert" style={styles.error}>{error || controller.error}</Text> : null}
      {!demoMode ? <Pressable accessibilityRole="button" accessibilityLabel="Use my device location" disabled={!controller.ready || controller.busy}
        accessibilityState={{ disabled: !controller.ready || controller.busy }} style={styles.control} onPress={() => { void controller.useDevice().then((accepted) => { if (accepted) onClose(); }); }}>
        <Text style={styles.controlText}>{controller.busy ? 'Finding location…' : 'Use my device location'}</Text>
      </Pressable> : <Text style={styles.copy}>Demo uses manual sample search points. Device location stays off.</Text>}
      <Text style={styles.copy}>Device location expires after 15 minutes. Manual points stay until you clear them or clear local account data.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Choose a point on the map" accessibilityState={{ expanded: showMap }} style={styles.control} onPress={() => setShowMap((value) => !value)}>
        <Text style={styles.controlText}>{showMap ? 'Hide map picker' : 'Choose a point on the map'}</Text>
      </Pressable>
      {showMap ? <View style={localStyles.map}>
        <Text style={styles.copy}>Tap the map to select a point. The starting view is not your location. Viewed regions go to the map provider.</Text>
        <MapView provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} userInterfaceStyle={scheme} style={localStyles.mapCanvas} initialRegion={region}
          onPress={(event) => choose(event.nativeEvent.coordinate)}>
          {selected ? <Marker coordinate={selected} title="Selected search point" /> : null}
        </MapView>
      </View> : null}
      <View style={styles.range}>
        <View style={styles.field}><Text style={styles.label}>Latitude</Text><TextInput accessibilityLabel="Search latitude" value={latitude} onChangeText={(value) => { setLatitude(value); setSelected(null); }} keyboardType="numbers-and-punctuation" style={styles.input} /></View>
        <View style={styles.field}><Text style={styles.label}>Longitude</Text><TextInput accessibilityLabel="Search longitude" value={longitude} onChangeText={(value) => { setLongitude(value); setSelected(null); }} keyboardType="numbers-and-punctuation" style={styles.input} /></View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Use selected search point" disabled={!controller.ready || controller.busy} accessibilityState={{ disabled: !controller.ready || controller.busy }} style={[styles.control, styles.primary]} onPress={() => { void saveManual(); }}>
        <Text style={[styles.controlText, styles.primaryText]}>Use selected search point</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Clear search location" disabled={!controller.ready || controller.busy} accessibilityState={{ disabled: !controller.ready || controller.busy }} style={styles.control} onPress={() => { void controller.clear().then((accepted) => { if (accepted) onClose(); }); }}>
        <Text style={styles.controlText}>Clear search location</Text>
      </Pressable>
    </FiltersBottomSheet>
  );
}
const localStyles = StyleSheet.create({ map: { gap: 8 }, mapCanvas: { height: 260, width: '100%', borderRadius: 12 } });
