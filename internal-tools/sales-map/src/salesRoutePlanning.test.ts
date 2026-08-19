import { describe, expect, it } from 'vitest';
import { orderRouteByPriority, orderRouteByProximity } from './salesRoutePlanning';

const ids = {
  austin: 'bullets-card-club-austin',
  dallas: 'champions-social-club-dallas-dallas',
  elPaso: 'bluefelt-el-paso-card-club-el-paso',
  houston: '9-dragons-social-club-houston',
  katyFirst: '101-poker-club-katy',
  katySecond: 'katy-poker-katy',
  katyThird: 'ny-poker-club-katy',
  midland: 'basin-poker-club-midland',
  odessa: 'celebrity-card-club-odessa-odessa',
  sanAntonio: 'ace-card-club-san-antonio'
} as const;

describe('cold-call route planning', () => {
  describe('orderRouteByProximity', () => {
    it('retains the first stop and greedily selects the closest remaining city point', () => {
      expect(orderRouteByProximity([
        ids.elPaso,
        ids.houston,
        ids.sanAntonio,
        ids.midland,
        ids.odessa
      ])).toEqual([
        ids.elPaso,
        ids.odessa,
        ids.midland,
        ids.sanAntonio,
        ids.houston
      ]);
    });

    it('uses catalog order for same-city distance ties regardless of supplied route order', () => {
      expect(orderRouteByProximity([
        ids.katyFirst,
        ids.katyThird,
        ids.houston,
        ids.katySecond
      ])).toEqual([
        ids.katyFirst,
        ids.katySecond,
        ids.katyThird,
        ids.houston
      ]);
    });

    it('returns fresh empty and singleton arrays without mutating its input', () => {
      const empty = Object.freeze([]) as readonly string[];
      const singleton = Object.freeze([ids.austin]);

      const emptyResult = orderRouteByProximity(empty);
      const singletonResult = orderRouteByProximity(singleton);

      expect(emptyResult).toEqual([]);
      expect(emptyResult).not.toBe(empty);
      expect(singletonResult).toEqual([ids.austin]);
      expect(singletonResult).not.toBe(singleton);
    });
  });

  describe('orderRouteByPriority', () => {
    it('sorts modeled venues by weight, then keeps unmodeled venues in route order', () => {
      const route = [ids.houston, ids.austin, ids.dallas, ids.sanAntonio, ids.elPaso];
      const weightedById = new Map([
        [ids.austin, { weight: 0.25 }],
        [ids.dallas, { weight: 0.6 }],
        [ids.sanAntonio, { weight: 0.6 }]
      ]);

      expect(orderRouteByPriority(route, weightedById)).toEqual([
        ids.dallas,
        ids.sanAntonio,
        ids.austin,
        ids.houston,
        ids.elPaso
      ]);
    });

    it('treats a modeled zero weight as higher priority than an unmodeled stop', () => {
      expect(orderRouteByPriority(
        [ids.houston, ids.austin],
        new Map([[ids.austin, { weight: 0 }]])
      )).toEqual([ids.austin, ids.houston]);
    });

    it('returns a new array and does not mutate the route or weights', () => {
      const route = Object.freeze([ids.houston, ids.austin, ids.dallas]);
      const weightedVenue = Object.freeze({ weight: 0.75 });
      const weightedById = new Map([[ids.dallas, weightedVenue]]);

      const result = orderRouteByPriority(route, weightedById);

      expect(result).toEqual([ids.dallas, ids.houston, ids.austin]);
      expect(route).toEqual([ids.houston, ids.austin, ids.dallas]);
      expect(weightedById.get(ids.dallas)).toBe(weightedVenue);
      expect(result).not.toBe(route);
    });
  });

  it.each([
    ['proximity', () => orderRouteByProximity([ids.austin, ids.austin])],
    ['priority', () => orderRouteByPriority([ids.austin, ids.austin], new Map())]
  ])('rejects duplicate venue IDs for %s ordering', (_label, orderRoute) => {
    expect(orderRoute).toThrow(/Duplicate Texas venue ID/);
  });

  it.each([
    ['proximity', () => orderRouteByProximity(['not-a-catalog-venue'])],
    ['priority', () => orderRouteByPriority(['not-a-catalog-venue'], new Map())]
  ])('rejects unknown venue IDs for %s ordering', (_label, orderRoute) => {
    expect(orderRoute).toThrow(/Unknown Texas venue ID/);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01])(
    'rejects an invalid priority weight of %s',
    (weight) => {
      expect(() => orderRouteByPriority(
        [ids.austin],
        new Map([[ids.austin, { weight }]])
      )).toThrow(/must be finite and non-negative/);
    }
  );
});
