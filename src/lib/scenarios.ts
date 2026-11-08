/**
 * Business scenario model. EVERYTHING here is a forecast built from assumptions the user can edit.
 * It never reads measured data on its own; the UI may offer a measured value as an explicit, visible suggestion.
 *
 * Per scenario s (monthly):
 *   effectiveMin_s     = improvedMin_s + reviewMin                       (minutes per accepted variation, incl. extra review)
 *   netHours_s         = hoursPerMonth - onboardingHours / amortMonths   (onboarding is amortised, not free)
 *   capacity_s         = netHours_s * 60 / effectiveMin_s
 *   baselineCapacity   = hoursPerMonth * 60 / baselineMin
 *   extraVariations_s  = capacity_s - baselineCapacity                   (signed)
 *   incrementalSpend_s = max(0, extraVariations_s) * spendPerVariation   (media budget needed to test the extra creatives)
 *   gross_s            = incrementalSpend_s * marginalRomi_s             (return net of that spend, by definition of ROMI)
 *   costs_s            = capacity_s * aiCostUsd * usdToEgp               (AI/API for every variation made)
 *                      + opexEgpMonth                                    (tools, hosting, other running costs)
 *                      + onboardingHours * hourlyRateEgp / amortMonths   (people cost of onboarding)
 *   netEgp_s           = gross_s - costs_s
 *   breakEvenRomi_s    = costs_s / incrementalSpend_s                    (ROMI needed for netEgp_s = 0)
 */

export type ScenarioId = "conservative" | "base" | "optimistic";
export const SCENARIO_IDS: readonly ScenarioId[] = ["conservative", "base", "optimistic"];

export interface ScenarioInputs {
  baselineMin: number;
  hoursPerMonth: number;
  reviewMin: number;
  aiCostUsd: number;
  usdToEgp: number;
  opexEgpMonth: number;
  onboardingHours: number;
  hourlyRateEgp: number;
  amortMonths: number;
  spendPerVariationEgp: number;
  scenarios: Record<ScenarioId, { improvedMin: number; romi: number }>;
}

/** Illustrative placeholders, NOT measurements. Targets 86 and 58 min come from the business brief. */
export const DEFAULT_INPUTS: ScenarioInputs = {
  baselineMin: 180,
  hoursPerMonth: 80,
  reviewMin: 10,
  aiCostUsd: 0.01,
  usdToEgp: 50,
  opexEgpMonth: 1500,
  onboardingHours: 12,
  hourlyRateEgp: 200,
  amortMonths: 6,
  spendPerVariationEgp: 2000,
  scenarios: {
    conservative: { improvedMin: 120, romi: 0.05 },
    base: { improvedMin: 86, romi: 0.15 },
    optimistic: { improvedMin: 58, romi: 0.3 },
  },
};

export interface ScenarioResult {
  id: ScenarioId;
  improvedMin: number;
  effectiveMin: number;
  reductionPct: number;
  netHours: number;
  capacity: number;
  baselineCapacity: number;
  extraVariations: number;
  incrementalSpendEgp: number;
  grossReturnEgp: number;
  aiCostEgp: number;
  opexEgp: number;
  onboardingEgp: number;
  totalCostsEgp: number;
  netEgp: number;
  breakEvenRomi: number | null;
}

/** Why an input set cannot be computed, or null when it is fine. */
export function validateInputs(i: ScenarioInputs): string | null {
  const positive: [string, number][] = [
    ["Baseline minutes", i.baselineMin], ["Monthly hours", i.hoursPerMonth], ["Amortisation months", i.amortMonths],
    ...SCENARIO_IDS.map((id): [string, number] => [`${id} minutes`, i.scenarios[id].improvedMin + i.reviewMin]),
  ];
  for (const [name, v] of positive) if (!Number.isFinite(v) || v <= 0) return `${name} must be greater than 0.`;
  const nonNegative: [string, number][] = [
    ["Review minutes", i.reviewMin], ["AI cost", i.aiCostUsd], ["USD to EGP rate", i.usdToEgp], ["Other running costs", i.opexEgpMonth],
    ["Onboarding hours", i.onboardingHours], ["Hourly cost", i.hourlyRateEgp], ["Spend per extra variation", i.spendPerVariationEgp],
    ...SCENARIO_IDS.map((id): [string, number] => [`${id} ROMI`, i.scenarios[id].romi]),
  ];
  for (const [name, v] of nonNegative) if (!Number.isFinite(v) || v < 0) return `${name} cannot be negative.`;
  if (i.onboardingHours / i.amortMonths >= i.hoursPerMonth) return "Onboarding would use all available hours.";
  return null;
}

export function computeScenario(i: ScenarioInputs, id: ScenarioId): ScenarioResult {
  const { improvedMin, romi } = i.scenarios[id];
  const effectiveMin = improvedMin + i.reviewMin;
  const onboardingHoursPerMonth = i.onboardingHours / i.amortMonths;
  const netHours = i.hoursPerMonth - onboardingHoursPerMonth;
  const capacity = (netHours * 60) / effectiveMin;
  const baselineCapacity = (i.hoursPerMonth * 60) / i.baselineMin;
  const extraVariations = capacity - baselineCapacity;
  const incrementalSpendEgp = Math.max(0, extraVariations) * i.spendPerVariationEgp;
  const grossReturnEgp = incrementalSpendEgp * romi;
  const aiCostEgp = capacity * i.aiCostUsd * i.usdToEgp;
  const onboardingEgp = onboardingHoursPerMonth * i.hourlyRateEgp;
  const totalCostsEgp = aiCostEgp + i.opexEgpMonth + onboardingEgp;
  return {
    id, improvedMin, effectiveMin,
    reductionPct: (1 - effectiveMin / i.baselineMin) * 100,
    netHours, capacity, baselineCapacity, extraVariations,
    incrementalSpendEgp, grossReturnEgp, aiCostEgp, opexEgp: i.opexEgpMonth, onboardingEgp, totalCostsEgp,
    netEgp: grossReturnEgp - totalCostsEgp,
    breakEvenRomi: incrementalSpendEgp > 0 ? totalCostsEgp / incrementalSpendEgp : null,
  };
}

export const computeAll = (i: ScenarioInputs): ScenarioResult[] => SCENARIO_IDS.map((id) => computeScenario(i, id));
