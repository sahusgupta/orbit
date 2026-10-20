import { isValidCoordinate } from './discovery';
import type { PlayerCoordinate } from './playerSync';

export function getPublishedMapRegion(input: readonly PlayerCoordinate[]) {
  const coordinates = input.filter(isValidCoordinate);
  if (!coordinates.length) return null;
  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const longitudes = coordinates.map((coordinate) => (coordinate.longitude + 360) % 360).sort((left, right) => left - right);
  let largestGap = -1;
  let firstLongitude = longitudes[0];
  for (let index = 0; index < longitudes.length; index += 1) {
    const next = index === longitudes.length - 1 ? longitudes[0] + 360 : longitudes[index + 1];
    const gap = next - longitudes[index];
    if (gap > largestGap) { largestGap = gap; firstLongitude = next % 360; }
  }
  const longitudeSpan = 360 - largestGap;
  const centerLongitude = (firstLongitude + longitudeSpan / 2 + 180) % 360 - 180;
  const latitudeDelta = Math.min(180, Math.max(0.04, (maximumLatitude - minimumLatitude) * 1.3));
  return {
    latitude: Math.max(-90 + latitudeDelta / 2, Math.min(90 - latitudeDelta / 2, (minimumLatitude + maximumLatitude) / 2)),
    longitude: centerLongitude,
    latitudeDelta,
    longitudeDelta: Math.min(360, Math.max(0.04, longitudeSpan * 1.3))
  };
}
