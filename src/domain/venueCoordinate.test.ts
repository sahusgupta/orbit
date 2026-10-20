import { describe, expect, it } from 'vitest';
import { decodeVenueCoordinate } from './venueCoordinate';

describe('authored venue coordinates', () => {
  it.each([{ latitude: 0, longitude: 0 }, { latitude: -90, longitude: -180 }, { latitude: 90, longitude: 180 }])(
    'accepts numeric bounds and strips unrelated metadata (%j)', (coordinate) => {
      const authored = { ...coordinate, accuracyMeters: 3, source: 'device', origin: { latitude: 1, longitude: 2 } };
      expect(decodeVenueCoordinate(authored)).toEqual(coordinate);
      expect(decodeVenueCoordinate(authored)).not.toBe(authored);
    }
  );

  it.each([
    undefined, null, [], {}, { latitude: 30 }, { latitude: '30', longitude: -96 },
    { latitude: 30, longitude: '-96' }, { latitude: 90.01, longitude: 0 },
    { latitude: 0, longitude: -180.01 }, { latitude: Number.NaN, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY }
  ])('leaves missing or malformed coordinates unknown (%j)', (value) => {
    expect(decodeVenueCoordinate(value)).toBeUndefined();
  });
});
