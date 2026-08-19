import { describe, expect, it } from 'vitest';
import {
  createTexasOutlinePath,
  isWithinTexasGeographicBounds,
  projectTexasCity,
  projectTexasCoordinate,
  TEXAS_CITY_COORDINATES,
  TEXAS_GEOGRAPHIC_BOUNDS,
  TEXAS_MAP_VIEWPORT,
  TEXAS_MAP_VIEW_BOX,
  TEXAS_OUTLINE_COORDINATES,
  TEXAS_OUTLINE_PATH
} from './texasMapGeometry';

const venueCities = [
  'Aledo',
  'Alpine',
  'Amarillo',
  'Austin',
  'Bacliff',
  'Baytown',
  'Beaumont',
  'Beeville',
  'Belton',
  'Brownsville',
  'Brownwood',
  'Bryan',
  'Burleson',
  'Caddo Mills',
  'Canton',
  'Carrollton',
  'Cedar Park',
  'College Station',
  'Corpus Christi',
  'Cypress',
  'Dallas',
  'Eagle Pass',
  'Edinburg',
  'El Paso',
  'Farwell',
  'Fort Worth',
  'Garland',
  'Georgetown',
  'Gordon',
  'Grand Prairie',
  'Houston',
  'Humble',
  'Huntsville',
  'Irving',
  'Katy',
  'Killeen',
  'Laredo',
  'Lubbock',
  'Lufkin',
  'Marble Falls',
  'McAllen',
  'Midland',
  'Mineral Wells',
  'Mission',
  'Navasota',
  'New Braunfels',
  'Odessa',
  'Pharr',
  'Port Lavaca',
  'Richmond',
  'Round Rock',
  'San Angelo',
  'San Antonio',
  'San Marcos',
  'Sherman',
  'Spring',
  'Stephenville',
  'Texarkana',
  'Victoria',
  'Waco',
  'Webster',
  'Wichita Falls',
  'Wilmer'
] as const;

describe('static Texas map geometry', () => {
  it('contains every distinct venue city from the supplied list', () => {
    expect(Object.keys(TEXAS_CITY_COORDINATES).sort()).toEqual([...venueCities].sort());
    expect(venueCities).toHaveLength(63);
  });

  it('keeps every city coordinate and projected point inside the map bounds', () => {
    Object.entries(TEXAS_CITY_COORDINATES).forEach(([city, coordinate]) => {
      expect(isWithinTexasGeographicBounds(coordinate), city).toBe(true);

      const point = projectTexasCoordinate(coordinate);
      expect(point.x, `${city} x`).toBeGreaterThanOrEqual(TEXAS_MAP_VIEWPORT.padding);
      expect(point.x, `${city} x`).toBeLessThanOrEqual(
        TEXAS_MAP_VIEWPORT.width - TEXAS_MAP_VIEWPORT.padding
      );
      expect(point.y, `${city} y`).toBeGreaterThanOrEqual(TEXAS_MAP_VIEWPORT.padding);
      expect(point.y, `${city} y`).toBeLessThanOrEqual(
        TEXAS_MAP_VIEWPORT.height - TEXAS_MAP_VIEWPORT.padding
      );
    });
  });

  it('projects the geographic extremes onto the padded SVG extremes', () => {
    expect(projectTexasCoordinate({
      latitude: TEXAS_GEOGRAPHIC_BOUNDS.north,
      longitude: TEXAS_GEOGRAPHIC_BOUNDS.west
    })).toEqual({ x: 32, y: 32 });
    expect(projectTexasCoordinate({
      latitude: TEXAS_GEOGRAPHIC_BOUNDS.south,
      longitude: TEXAS_GEOGRAPHIC_BOUNDS.east
    })).toEqual({ x: 968, y: 928 });
    expect(TEXAS_MAP_VIEW_BOX).toBe('0 0 1000 960');
  });

  it('preserves recognizable west-east and north-south city ordering', () => {
    const elPaso = projectTexasCity('El Paso');
    const austin = projectTexasCity('Austin');
    const beaumont = projectTexasCity('Beaumont');
    const amarillo = projectTexasCity('Amarillo');
    const brownsville = projectTexasCity('Brownsville');

    expect(elPaso.x).toBeLessThan(austin.x);
    expect(austin.x).toBeLessThan(beaumont.x);
    expect(amarillo.y).toBeLessThan(austin.y);
    expect(austin.y).toBeLessThan(brownsville.y);
  });

  it('provides a closed, detailed Texas SVG outline with no runtime dependency', () => {
    expect(TEXAS_OUTLINE_COORDINATES.length).toBeGreaterThan(150);
    expect(TEXAS_OUTLINE_PATH).toMatch(/^M\d/);
    expect(TEXAS_OUTLINE_PATH).toMatch(/ Z$/);
    expect(TEXAS_OUTLINE_PATH.match(/L/g)?.length).toBe(
      TEXAS_OUTLINE_COORDINATES.length - 1
    );
    expect(createTexasOutlinePath()).toBe(TEXAS_OUTLINE_PATH);
  });

  it('supports a custom SVG viewport and rejects invalid inputs', () => {
    expect(projectTexasCoordinate({ latitude: 31, longitude: -100 }, {
      width: 500,
      height: 480,
      padding: 16
    })).toEqual({
      x: expect.any(Number),
      y: expect.any(Number)
    });
    expect(() => projectTexasCoordinate({ latitude: Number.NaN, longitude: -100 })).toThrow(
      RangeError
    );
    expect(() => projectTexasCoordinate({ latitude: 31, longitude: -100 }, {
      width: 20,
      height: 20,
      padding: 10
    })).toThrow(RangeError);
  });
});
