import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { texasVenues } from './texasVenues';

describe('Texas venue catalog', () => {
  it('contains every supplied venue in source order', () => {
    expect(texasVenues).toHaveLength(132);
    expect(texasVenues[0]).toEqual({
      id: '101-poker-club-katy',
      name: '101 Poker Club',
      city: 'Katy',
      status: 'listed',
      note: '21+'
    });
    expect(texasVenues.at(-1)).toEqual({
      id: 'win-poker-social-club-san-antonio',
      name: 'Win Poker Social Club',
      city: 'San Antonio',
      status: 'listed',
      note: '21+'
    });
  });

  it('matches the accepted ordered name, city, and note catalog', () => {
    const canonicalCatalog = JSON.stringify(texasVenues.map(({ name, city, note }) => (
      [name, city, note]
    )));

    expect(createHash('sha256').update(canonicalCatalog).digest('hex'))
      .toBe('686066da308df27f410a3b7d6695f6c12742c78b5c82858bdc87d347f09049d1');
  });

  it('preserves the supplied city and advisory distribution', () => {
    const cityCounts = texasVenues.reduce<Record<string, number>>((counts, venue) => ({
      ...counts,
      [venue.city]: (counts[venue.city] ?? 0) + 1
    }), {});

    expect(Object.keys(cityCounts)).toHaveLength(63);
    expect(texasVenues.filter(({ note }) => note !== null)).toHaveLength(61);
    expect(cityCounts.Houston).toBe(13);
    expect(cityCounts['San Antonio']).toBe(10);
    expect(cityCounts.Dallas).toBe(6);
  });

  it('gives every venue and name-city pair a unique stable ID', () => {
    const ids = texasVenues.map(({ id }) => id);
    const nameCityPairs = texasVenues.map(({ name, city }) => `${name}\u0000${city}`);

    expect(new Set(ids).size).toBe(texasVenues.length);
    expect(new Set(nameCityPairs).size).toBe(texasVenues.length);
    expect(texasVenues.find(({ name }) => name === 'Aces & Arrows Poker Room')?.id)
      .toBe('aces-and-arrows-poker-room-killeen');
    expect(texasVenues.find(({ name }) => name === 'The Club EPTX / The Club Poker House')?.id)
      .toBe('the-club-eptx-the-club-poker-house-el-paso');
    expect(texasVenues.find(({ name }) => name === 'Johny’s Social Card Club')?.id)
      .toBe('johnys-social-card-club-wichita-falls');
  });

  it('preserves supplied notes and operational status wording at representative boundaries', () => {
    expect(texasVenues.find(({ name }) => name === 'Bluefelt El Paso Card Club'))
      .toEqual(expect.objectContaining({ city: 'El Paso', status: 'listed', note: null }));
    expect(texasVenues.find(({ name }) => name === 'Texline Card House'))
      .toEqual(expect.objectContaining({ city: 'Texarkana', status: 'listed', note: null }));
    expect(texasVenues.find(({ name }) => name === 'Suits Social Club'))
      .toEqual(expect.objectContaining({ city: 'Brownsville', status: 'listed', note: null }));
    expect(texasVenues.find(({ name }) => name === 'Amarillo Social Club'))
      .toEqual(expect.objectContaining({
        city: 'Amarillo',
        status: 'moving',
        note: 'moving September 1; call first'
      }));
    expect(texasVenues.find(({ name }) => name === 'Showdown Social Club'))
      .toEqual(expect.objectContaining({
        city: 'Sherman',
        status: 'planned-opening',
        note: 'planned Fall 2026 opening'
      }));
    expect(texasVenues.find(({ name }) => name === 'Sterling Social / Empire Poker Club Katy'))
      .toEqual(expect.objectContaining({
        city: 'Katy',
        status: 'status-check',
        note: '21+; branding/status check'
      }));
  });

  it('has no missing or whitespace-padded IDs, names, cities, or notes', () => {
    for (const venue of texasVenues) {
      expect(venue.id).not.toBe('');
      expect(venue.id).toBe(venue.id.trim());
      expect(venue.name).not.toBe('');
      expect(venue.name).toBe(venue.name.trim());
      expect(venue.city).not.toBe('');
      expect(venue.city).toBe(venue.city.trim());

      if (venue.note !== null) {
        expect(venue.note).not.toBe('');
        expect(venue.note).toBe(venue.note.trim());
      }
    }
  });
});
