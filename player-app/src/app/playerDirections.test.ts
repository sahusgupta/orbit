import { describe, expect, it } from 'vitest';
import { buildPlayerDirectionsUrl } from './playerDirections';

describe('Published venue directions URLs', () => {
  it('uses current Apple Maps driving URLs with validated coordinates and preserves older iOS support', () => {
    const coordinate = { latitude: 30.3, longitude: -97.7 };
    expect(buildPlayerDirectionsUrl('ios', 'A different street', coordinate, '26.0')).toBe('https://maps.apple.com/directions?destination=30.3%2C-97.7&mode=driving');
    expect(buildPlayerDirectionsUrl('ios', '', coordinate, '17.0')).toBe('https://maps.apple.com/?daddr=30.3%2C-97.7&dirflg=d');
  });
  it('encodes the actual published address and ignores invalid coordinates without inventing a destination', () => {
    expect(buildPlayerDirectionsUrl('ios', ' 100 Main & 2nd St ', { latitude: 91, longitude: 0 }, '26')).toContain('destination=100%20Main%20%26%202nd%20St');
    expect(buildPlayerDirectionsUrl('ios', '', { latitude: Number.NaN, longitude: 0 }, '26')).toBeNull();
    expect(buildPlayerDirectionsUrl('android', '100 Main St')).toBe('google.navigation:q=100%20Main%20St');
    expect(buildPlayerDirectionsUrl('web', '100 Main St')).toBe('https://www.google.com/maps/dir/?api=1&destination=100%20Main%20St');
  });
});
