import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  getExpectedNetValuePerFounderHour,
  getNormalizedSalesPlanningWeights,
  type SalesPlanningWeightResult
} from './salesPlanningWeights';

describe('standalone sales planning weights', () => {
  it('uses reverse normalized CAC and normalized net value per founder hour', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'low-cac', modeledEconomicCac: 100, expectedNetValuePerFounderHour: 10 },
      { id: 'high-value', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 30 },
      { id: 'middle', modeledEconomicCac: 300, expectedNetValuePerFounderHour: 20 }
    ]);

    expect(weighted).toEqual([
      expect.objectContaining({
        id: 'low-cac',
        normalizedModeledEconomicCacScore: 1,
        normalizedExpectedNetValuePerFounderHourScore: 0,
        score: 0.5
      }),
      expect.objectContaining({
        id: 'high-value',
        normalizedModeledEconomicCacScore: 0.5,
        normalizedExpectedNetValuePerFounderHourScore: 1,
        score: 0.75
      }),
      expect.objectContaining({
        id: 'middle',
        normalizedModeledEconomicCacScore: 0,
        normalizedExpectedNetValuePerFounderHourScore: 0.5,
        score: 0.25
      })
    ]);
    expect(weighted[0].weight).toBeCloseTo(1 / 3);
    expect(weighted[1].weight).toBeCloseTo(1 / 2);
    expect(weighted[2].weight).toBeCloseTo(1 / 6);
    expect(weighted.reduce((total, option) => total + option.weight, 0)).toBeCloseTo(1);
  });

  it('omits a flat metric and normalizes using the metric that distinguishes options', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'low', modeledEconomicCac: 200, expectedNetValuePerFounderHour: -50 },
      { id: 'middle', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 0 },
      { id: 'high', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 100 }
    ]);

    expect(weighted.map(({ score }) => score)).toEqual([0, 1 / 3, 1]);
    expect(weighted.map(({ weight }) => weight)).toEqual([0, 0.25, 0.75]);
  });

  it('uses reverse CAC direction when net value per founder hour is flat', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'low', modeledEconomicCac: 100, expectedNetValuePerFounderHour: 50 },
      { id: 'middle', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 50 },
      { id: 'high', modeledEconomicCac: 400, expectedNetValuePerFounderHour: 50 }
    ]);

    expect(weighted.map(({ score }) => score)).toEqual([1, 2 / 3, 0]);
    expect(weighted[0].weight).toBeCloseTo(0.6);
    expect(weighted[1].weight).toBeCloseTo(0.4);
    expect(weighted[2].weight).toBe(0);
  });

  it('returns uniform weights when neither metric distinguishes the options', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'first', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 100 },
      { id: 'second', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 100 }
    ]);

    expect(weighted).toEqual([
      expect.objectContaining({
        id: 'first',
        normalizedModeledEconomicCacScore: 0.5,
        normalizedExpectedNetValuePerFounderHourScore: 0.5,
        score: 0.5,
        weight: 0.5
      }),
      expect.objectContaining({
        id: 'second',
        normalizedModeledEconomicCacScore: 0.5,
        normalizedExpectedNetValuePerFounderHourScore: 0.5,
        score: 0.5,
        weight: 0.5
      })
    ]);
  });

  it('allows explicit metric contributions while keeping the result normalized', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'cac', modeledEconomicCac: 100, expectedNetValuePerFounderHour: 10 },
      { id: 'value', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 20 }
    ], {
      modeledEconomicCac: 3,
      expectedNetValuePerFounderHour: 1
    });

    expect(weighted[0]).toEqual(expect.objectContaining({ id: 'cac', score: 0.75, weight: 0.75 }));
    expect(weighted[1]).toEqual(expect.objectContaining({ id: 'value', score: 0.25, weight: 0.25 }));
  });

  it('supports disabling either metric contribution', () => {
    const options = [
      { id: 'cac', modeledEconomicCac: 100, expectedNetValuePerFounderHour: 10 },
      { id: 'value', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 20 }
    ];

    expect(getNormalizedSalesPlanningWeights(options, {
      modeledEconomicCac: 1,
      expectedNetValuePerFounderHour: 0
    }).map(({ weight }) => weight)).toEqual([1, 0]);
    expect(getNormalizedSalesPlanningWeights(options, {
      modeledEconomicCac: 0,
      expectedNetValuePerFounderHour: 1
    }).map(({ weight }) => weight)).toEqual([0, 1]);
  });

  it('scales finite contributions before combining them to avoid overflow', () => {
    const weighted = getNormalizedSalesPlanningWeights([
      { id: 'best', modeledEconomicCac: 100, expectedNetValuePerFounderHour: 20 },
      { id: 'worst', modeledEconomicCac: 200, expectedNetValuePerFounderHour: 10 }
    ], {
      modeledEconomicCac: Number.MAX_VALUE,
      expectedNetValuePerFounderHour: Number.MAX_VALUE
    });

    expect(weighted).toEqual([
      expect.objectContaining({ id: 'best', score: 1, weight: 1 }),
      expect.objectContaining({ id: 'worst', score: 0, weight: 0 })
    ]);
  });

  it('preserves order, caller metadata, and input values', () => {
    const options = [
      { id: 'first', region: 'Houston', modeledEconomicCac: 0, expectedNetValuePerFounderHour: 25 },
      { id: 'second', region: 'Austin', modeledEconomicCac: 300, expectedNetValuePerFounderHour: 10 }
    ] as const;
    const snapshot = structuredClone(options);
    const weighted = getNormalizedSalesPlanningWeights(options);

    expect(weighted.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(weighted[0].region).toBe('Houston');
    expect(options).toEqual(snapshot);
    expectTypeOf(weighted).toEqualTypeOf<Array<SalesPlanningWeightResult<(typeof options)[number]>>>();
  });

  it('replaces caller fields reserved for computed weighting output', () => {
    const weighted = getNormalizedSalesPlanningWeights([{
      modeledEconomicCac: 100,
      expectedNetValuePerFounderHour: 20,
      score: 'stale',
      weight: 'stale'
    }]);

    expect(weighted[0]).toEqual(expect.objectContaining({ score: 0.5, weight: 1 }));
    expectTypeOf(weighted[0].score).toEqualTypeOf<number>();
    expectTypeOf(weighted[0].weight).toEqualTypeOf<number>();
  });

  it('handles empty and single-option cohorts', () => {
    expect(getNormalizedSalesPlanningWeights([])).toEqual([]);
    expect(getNormalizedSalesPlanningWeights([
      { modeledEconomicCac: 0, expectedNetValuePerFounderHour: -25 }
    ])).toEqual([
      {
        modeledEconomicCac: 0,
        expectedNetValuePerFounderHour: -25,
        normalizedModeledEconomicCacScore: 0.5,
        normalizedExpectedNetValuePerFounderHourScore: 0.5,
        score: 0.5,
        weight: 1
      }
    ]);
  });

  it('calculates expected net value per founder hour without clamping losses', () => {
    expect(getExpectedNetValuePerFounderHour(1_437.5, 2.5)).toBe(575);
    expect(getExpectedNetValuePerFounderHour(-150, 3)).toBe(-50);
  });

  it.each([
    [{ modeledEconomicCac: Number.NaN, expectedNetValuePerFounderHour: 10 }],
    [{ modeledEconomicCac: Number.POSITIVE_INFINITY, expectedNetValuePerFounderHour: 10 }],
    [{ modeledEconomicCac: -1, expectedNetValuePerFounderHour: 10 }],
    [{ modeledEconomicCac: 10, expectedNetValuePerFounderHour: Number.NEGATIVE_INFINITY }]
  ])('rejects invalid option metrics: %j', (option) => {
    expect(() => getNormalizedSalesPlanningWeights([option])).toThrow(RangeError);
  });

  it.each([
    [{ modeledEconomicCac: -1, expectedNetValuePerFounderHour: 1 }],
    [{ modeledEconomicCac: 1, expectedNetValuePerFounderHour: -1 }],
    [{ modeledEconomicCac: Number.NaN, expectedNetValuePerFounderHour: 1 }],
    [{ modeledEconomicCac: 0, expectedNetValuePerFounderHour: 0 }]
  ])('rejects invalid metric contributions: %j', (contributions) => {
    expect(() => getNormalizedSalesPlanningWeights([
      { modeledEconomicCac: 100, expectedNetValuePerFounderHour: 10 }
    ], contributions)).toThrow(RangeError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid founder hours: %s',
    (founderHours) => {
      expect(() => getExpectedNetValuePerFounderHour(100, founderHours)).toThrow(RangeError);
    }
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects invalid expected net value: %s',
    (expectedNetValue) => {
      expect(() => getExpectedNetValuePerFounderHour(expectedNetValue, 1)).toThrow(RangeError);
    }
  );
});
