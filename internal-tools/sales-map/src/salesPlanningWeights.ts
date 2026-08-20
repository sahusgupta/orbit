/** Pure weighting rules for the standalone internal sales map. */
export type SalesPlanningWeightInput = {
  modeledEconomicCac: number;
  expectedNetValuePerFounderHour: number;
};

export type SalesPlanningMetricContributions = {
  modeledEconomicCac: number;
  expectedNetValuePerFounderHour: number;
};

type ComputedSalesPlanningWeight = {
  normalizedModeledEconomicCacScore: number;
  normalizedExpectedNetValuePerFounderHourScore: number;
  score: number;
  weight: number;
};

export type SalesPlanningWeightResult<Option extends SalesPlanningWeightInput> =
  Omit<Option, keyof ComputedSalesPlanningWeight> & ComputedSalesPlanningWeight;

export const DEFAULT_SALES_PLANNING_METRIC_CONTRIBUTIONS: Readonly<SalesPlanningMetricContributions> = {
  modeledEconomicCac: 0.5,
  expectedNetValuePerFounderHour: 0.5
};

const assertFinite = (value: number, label: string) => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite.`);
  }
};

const getUniformWeight = (count: number) => count ? 1 / count : 0;

/**
 * Converts an already calculated expected net value into the founder-time
 * efficiency metric used by the sales-planning weights.
 */
export const getExpectedNetValuePerFounderHour = (expectedNetValue: number, founderHours: number) => {
  assertFinite(expectedNetValue, 'Expected net value');
  assertFinite(founderHours, 'Founder hours');
  if (founderHours <= 0) {
    throw new RangeError('Founder hours must be greater than zero.');
  }

  const value = expectedNetValue / founderHours;
  assertFinite(value, 'Expected net value per founder hour');
  return value;
};

/**
 * Computes relative weights within one comparable sales-planning cohort.
 *
 * Modeled economic CAC uses reverse min-max normalization because lower CAC is
 * preferable. Expected net value per founder hour uses forward min-max
 * normalization because higher value is preferable. A flat metric is plotted
 * at the neutral midpoint and omitted from the composite score; when both
 * metrics are flat, every option receives a neutral composite score and the
 * same weight. Callers must compare options from the same value horizon and
 * founder-time scenario.
 */
export function getNormalizedSalesPlanningWeights<Option extends SalesPlanningWeightInput>(
  options: readonly Option[],
  contributions: Readonly<SalesPlanningMetricContributions> = DEFAULT_SALES_PLANNING_METRIC_CONTRIBUTIONS
): SalesPlanningWeightResult<Option>[] {
  assertFinite(contributions.modeledEconomicCac, 'Modeled economic CAC contribution');
  assertFinite(
    contributions.expectedNetValuePerFounderHour,
    'Expected net value per founder hour contribution'
  );
  if (contributions.modeledEconomicCac < 0 || contributions.expectedNetValuePerFounderHour < 0) {
    throw new RangeError('Sales-planning metric contributions cannot be negative.');
  }
  if (contributions.modeledEconomicCac + contributions.expectedNetValuePerFounderHour <= 0) {
    throw new RangeError('At least one sales-planning metric contribution must be greater than zero.');
  }

  const contributionScale = Math.max(
    contributions.modeledEconomicCac,
    contributions.expectedNetValuePerFounderHour
  );
  const scaledModeledCacContribution = contributions.modeledEconomicCac / contributionScale;
  const scaledNetValuePerHourContribution = contributions.expectedNetValuePerFounderHour
    / contributionScale;

  if (!options.length) return [];

  options.forEach((option, index) => {
    assertFinite(option.modeledEconomicCac, `Option ${index} modeled economic CAC`);
    assertFinite(
      option.expectedNetValuePerFounderHour,
      `Option ${index} expected net value per founder hour`
    );
    if (option.modeledEconomicCac < 0) {
      throw new RangeError(`Option ${index} modeled economic CAC cannot be negative.`);
    }
  });

  const ranges = options.slice(1).reduce((current, option) => ({
    minimumModeledCac: Math.min(current.minimumModeledCac, option.modeledEconomicCac),
    maximumModeledCac: Math.max(current.maximumModeledCac, option.modeledEconomicCac),
    minimumNetValuePerHour: Math.min(
      current.minimumNetValuePerHour,
      option.expectedNetValuePerFounderHour
    ),
    maximumNetValuePerHour: Math.max(
      current.maximumNetValuePerHour,
      option.expectedNetValuePerFounderHour
    )
  }), {
    minimumModeledCac: options[0].modeledEconomicCac,
    maximumModeledCac: options[0].modeledEconomicCac,
    minimumNetValuePerHour: options[0].expectedNetValuePerFounderHour,
    maximumNetValuePerHour: options[0].expectedNetValuePerFounderHour
  });
  const {
    minimumModeledCac,
    maximumModeledCac,
    minimumNetValuePerHour,
    maximumNetValuePerHour
  } = ranges;
  const modeledCacRange = maximumModeledCac - minimumModeledCac;
  const netValuePerHourRange = maximumNetValuePerHour - minimumNetValuePerHour;
  const modeledCacVaries = modeledCacRange > 0 && scaledModeledCacContribution > 0;
  const netValuePerHourVaries = netValuePerHourRange > 0
    && scaledNetValuePerHourContribution > 0;
  const activeContributionTotal = (modeledCacVaries ? scaledModeledCacContribution : 0)
    + (netValuePerHourVaries ? scaledNetValuePerHourContribution : 0);

  if (!Number.isFinite(modeledCacRange) || !Number.isFinite(netValuePerHourRange)) {
    throw new RangeError('Sales-planning metric ranges must be finite.');
  }

  const normalized = options.map((option) => {
    const normalizedModeledEconomicCacScore = modeledCacRange > 0
      ? (maximumModeledCac - option.modeledEconomicCac) / modeledCacRange
      : 0.5;
    const normalizedExpectedNetValuePerFounderHourScore = netValuePerHourRange > 0
      ? (option.expectedNetValuePerFounderHour - minimumNetValuePerHour) / netValuePerHourRange
      : 0.5;
    return {
      ...option,
      normalizedModeledEconomicCacScore,
      normalizedExpectedNetValuePerFounderHourScore
    };
  });

  if (activeContributionTotal <= 0) {
    const weight = getUniformWeight(normalized.length);
    return normalized.map((option) => ({ ...option, score: 0.5, weight }));
  }

  const scored = normalized.map((option) => {
    const score = (
      (modeledCacVaries
        ? option.normalizedModeledEconomicCacScore * scaledModeledCacContribution
        : 0)
      + (netValuePerHourVaries
        ? option.normalizedExpectedNetValuePerFounderHourScore * scaledNetValuePerHourContribution
        : 0)
    ) / activeContributionTotal;

    return {
      ...option,
      score,
      weight: 0
    };
  });
  const scoreTotal = scored.reduce((total, option) => total + option.score, 0);

  if (!Number.isFinite(scoreTotal) || scoreTotal <= 0) {
    const weight = getUniformWeight(scored.length);
    return scored.map((option) => ({ ...option, weight }));
  }

  return scored.map((option) => ({ ...option, weight: option.score / scoreTotal }));
}
