import { describe, expect, it } from 'vitest';
import { getPublishedMapRegion } from './publishedMapRegion';

describe('Published venue map framing', () => {
  it('has no region without valid published coordinates', () => {
    expect(getPublishedMapRegion([])).toBeNull();
    expect(getPublishedMapRegion([{ latitude: Number.NaN, longitude: 0 }, { latitude: 91, longitude: 181 }])).toBeNull();
  });
  it('frames every valid venue across different cities instead of centering only the first', () => {
    const points = [{ latitude: 30.3, longitude: -97.7 }, { latitude: 41.9, longitude: -87.6 }, { latitude: 39.7, longitude: -105 }, { latitude: 36.2, longitude: -115.1 }];
    const region = getPublishedMapRegion(points);
    expect(region).not.toBeNull();
    for (const point of points) {
      expect(Math.abs(point.latitude - region!.latitude)).toBeLessThan(region!.latitudeDelta / 2);
      expect(Math.abs(point.longitude - region!.longitude)).toBeLessThan(region!.longitudeDelta / 2);
    }
    expect(getPublishedMapRegion([...points].reverse())).toEqual(region);
  });
  it('uses the short map span across the antimeridian and keeps a single point visible', () => {
    const region = getPublishedMapRegion([{ latitude: 10, longitude: 179 }, { latitude: 12, longitude: -179 }]);
    expect(region?.longitude).toBe(-180);
    expect(region?.longitudeDelta).toBeCloseTo(2.6);
    expect(getPublishedMapRegion([{ latitude: 90, longitude: 180 }])?.latitude).toBeLessThan(90);
  });
});
