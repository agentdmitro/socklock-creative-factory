"use client";

import { useEffect, useMemo, useState } from "react";
import type { InsightsReport } from "@/lib/analytics";
import { computeAll, DEFAULT_INPUTS, SCENARIO_IDS, validateInputs, type ScenarioId, type ScenarioInputs, type ScenarioResult } from "@/lib/scenarios";
import { Calculator01Icon, Clock01Icon, Coins01Icon, Layers01Icon, Refresh01Icon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { Badge } from "./Badge";
import { Icon } from "./Icon";
import { Button } from "./Button";
import { NumberField } from "./Field";
import styles from "./ScenarioCalculator.module.scss";
import shared from "./steps.module.scss";

/** Below this many accepted variations a measured average is too thin to suggest as a forecast input. */
const MIN_ACCEPTED_FOR_SUGGESTION = 3;
const STORAGE_KEY = "cvf.scenario.v1";
const LABEL: Record<ScenarioId, string> = { conservative: "Conservative", base: "Base", optimistic: "Optimistic" };

/** Form state is kept as text so a field can be emptied and retyped; ROMI is entered as a percentage. */
type Raw = Record<string, string>;

const toRaw = (i: ScenarioInputs): Raw => ({
  baselineMin: String(i.baselineMin), hoursPerMonth: String(i.hoursPerMonth), reviewMin: String(i.reviewMin),
  aiCostUsd: String(i.aiCostUsd), usdToEgp: String(i.usdToEgp), opexEgpMonth: String(i.opexEgpMonth),
  onboardingHours: String(i.onboardingHours), hourlyRateEgp: String(i.hourlyRateEgp), amortMonths: String(i.amortMonths),
  spendPerVariationEgp: String(i.spendPerVariationEgp),
  ...Object.fromEntries(SCENARIO_IDS.flatMap((id) => [[`${id}.min`, String(i.scenarios[id].improvedMin)], [`${id}.romi`, String(Math.round(i.scenarios[id].romi * 1000) / 10)]])),
});

const parse = (r: Raw): ScenarioInputs => {
  const n = (k: string) => (r[k]?.trim() ? Number(r[k]) : NaN);
  return {
    baselineMin: n("baselineMin"), hoursPerMonth: n("hoursPerMonth"), reviewMin: n("reviewMin"), aiCostUsd: n("aiCostUsd"), usdToEgp: n("usdToEgp"),
    opexEgpMonth: n("opexEgpMonth"), onboardingHours: n("onboardingHours"), hourlyRateEgp: n("hourlyRateEgp"), amortMonths: n("amortMonths"),
    spendPerVariationEgp: n("spendPerVariationEgp"),
    scenarios: Object.fromEntries(SCENARIO_IDS.map((id) => [id, { improvedMin: n(`${id}.min`), romi: n(`${id}.romi`) / 100 }])) as ScenarioInputs["scenarios"],
  };
};

const egp = new Intl.NumberFormat("en", { style: "currency", currency: "EGP", maximumFractionDigits: 0, currencyDisplay: "code" });
const num1 = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });
const signed = (n: number, f: (x: number) => string) => (n < 0 ? `−${f(-n)}` : f(n));

export function ScenarioCalculator({ measured }: { measured: InsightsReport | null }) {
  // Rendered only after a client-side tab switch, never during SSR, so reading storage here cannot mismatch hydration.
  const [raw, setRaw] = useState<Raw>(() => {
    const defaults = toRaw(DEFAULT_INPUTS);
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaults, ...(JSON.parse(saved) as Raw) } : defaults;
    } catch {
      return defaults; // storage unavailable: defaults are fine
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    } catch {
      /* ignore */
    }
  }, [raw]);

  const set = (key: string) => (e: { target: { value: string } }) => setRaw((r) => ({ ...r, [key]: e.target.value }));
  const inputs = useMemo(() => parse(raw), [raw]);
  const problem = useMemo(() => validateInputs(inputs), [inputs]);
  const results = useMemo(() => (problem ? null : computeAll(inputs)), [inputs, problem]);

  // Offer measured values only when they rest on enough real work: a handful of accepted videos and a plausible time.
  const enough = (measured?.humanTime.acceptedInTimedSessions ?? 0) >= MIN_ACCEPTED_FOR_SUGGESTION;
  const measuredMin = enough && (measured?.humanTime.minutesPerAccepted ?? 0) >= 1 ? (measured?.humanTime.minutesPerAccepted ?? null) : null;
  const measuredCost = enough && (measured?.ai.costPerAcceptedUsd ?? 0) > 0 ? (measured?.ai.costPerAcceptedUsd ?? null) : null; // Mock-only runs cost 0: not informative
  const field = (key: string, label: string, unit: string, extra: { hint?: string; step?: string } = {}) => (
    <NumberField label={label} unit={unit} value={raw[key] ?? ""} onChange={set(key)} min={0} step={extra.step ?? "any"} hint={extra.hint} />
  );

  return (
    <div className={styles.wrap}>
      <section className={styles.banner} aria-labelledby="forecast-title">
        <div className={styles.bannerHead}>
          <Badge tone="forecast">Forecast</Badge>
          <h3 id="forecast-title" className={styles.title}><Icon icon={Calculator01Icon} size={18} />Business scenario calculator</h3>
        </div>
        <p>
          Everything on this tab is a <b>projection from assumptions you can edit</b>, not a measurement and not a promise.
          The starting values are illustrative placeholders: replace each one with your own figures before using any result.
          The minute targets (180 → 86 → 58) come from the brief and are goals, not achieved results.
        </p>
      </section>

      <fieldset className={styles.group}>
        <legend><Icon icon={Clock01Icon} size={16} />Time</legend>
        <div className={styles.grid}>
          {field("baselineMin", "Baseline minutes per accepted variation", "min", { hint: "Today's manual process (reference figure)." })}
          {field("hoursPerMonth", "Available production hours per month", "h", { hint: "Designer hours you can put into this work." })}
          {field("reviewMin", "Extra review per accepted variation", "min", { hint: "Checking claims, approvals: added on top of the improved time." })}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend><Icon icon={Layers01Icon} size={16} />Scenarios</legend>
        <div className={styles.cols}>
          {SCENARIO_IDS.map((id) => (
            <div key={id} className={styles.col}>
              <p className={styles.colTitle}>{LABEL[id]}</p>
              {field(`${id}.min`, "Improved minutes per accepted", "min")}
              {id === "base" && measuredMin !== null && (
                <button type="button" className={styles.use} onClick={() => setRaw((r) => ({ ...r, "base.min": String(Math.round(measuredMin * 10) / 10) }))}>
                  Use my measured {measuredMin.toFixed(1)} min <span>(in-tool time only)</span>
                </button>
              )}
              {field(`${id}.romi`, "Marginal ROMI", "%", { hint: "Return per EGP of extra media spend, after that spend." })}
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend><Icon icon={Coins01Icon} size={16} />Return and costs</legend>
        <div className={styles.grid}>
          {field("spendPerVariationEgp", "Media spend to test each extra variation", "EGP", { hint: "Incremental spend, not existing budget." })}
          {field("aiCostUsd", "AI/API cost per accepted variation", "USD", { step: "0.001" })}
          {field("usdToEgp", "USD to EGP rate", "EGP", { hint: "Check the current rate." })}
          {field("opexEgpMonth", "Other running costs per month", "EGP", { hint: "Tools, hosting, licences, storage." })}
          {field("onboardingHours", "One-time onboarding effort", "h", { hint: "Training and setup for the team." })}
          {field("hourlyRateEgp", "Cost per onboarding hour", "EGP")}
          {field("amortMonths", "Spread onboarding over", "months")}
        </div>
        {measuredCost !== null && (
          <button type="button" className={styles.use} onClick={() => setRaw((r) => ({ ...r, aiCostUsd: String(measuredCost) }))}>
            Use my measured AI cost {measuredCost.toFixed(4)} USD per accepted <span>(estimate from list prices)</span>
          </button>
        )}
      </fieldset>

      <div className={styles.actions}>
        <Button variant="ghost" icon={Refresh01Icon} onClick={() => setRaw(toRaw(DEFAULT_INPUTS))}>Reset to placeholders</Button>
      </div>

      {problem || !results ? (
        <p className={shared.notice} role="alert">{problem ?? "Check the inputs."}</p>
      ) : (
        <Results results={results} inputs={inputs} />
      )}

      <details className={styles.how}>
        <summary>How this is calculated</summary>
        <ol>
          <li>Minutes per accepted variation = improved minutes + extra review minutes.</li>
          <li>Usable hours = monthly hours − onboarding hours ÷ spread months.</li>
          <li>Capacity = usable hours × 60 ÷ minutes per accepted variation. Baseline capacity = monthly hours × 60 ÷ baseline minutes.</li>
          <li>Extra variations = capacity − baseline capacity. Incremental spend = extra variations × media spend per variation (zero if negative).</li>
          <li>Return = incremental spend × marginal ROMI (ROMI is already net of the spend itself).</li>
          <li>Costs = AI cost × capacity × USD→EGP + other running costs + onboarding hours × hourly cost ÷ spread months.</li>
          <li>Net incremental EGP = return − costs. Break-even ROMI = costs ÷ incremental spend.</li>
        </ol>
        <p>Not modelled: seasonality, creative fatigue, diminishing returns beyond the ROMI you enter, tax. Saved assumptions stay in this browser only.</p>
      </details>
    </div>
  );
}

function Results({ results, inputs }: { results: ScenarioResult[]; inputs: ScenarioInputs }) {
  const rows: { label: string; note?: string; cell: (r: ScenarioResult) => string; strong?: boolean; tone?: (r: ScenarioResult) => boolean }[] = [
    { label: "Minutes per accepted variation", note: "improved + review", cell: (r) => `${num1.format(r.effectiveMin)} min` },
    { label: "Reduction vs baseline", cell: (r) => `${signed(r.reductionPct, (x) => `${Math.round(x)}%`)}` },
    { label: "Usable hours per month", note: "after onboarding", cell: (r) => `${num1.format(r.netHours)} h` },
    { label: "Monthly capacity", note: "accepted variations", cell: (r) => num1.format(r.capacity) },
    { label: "Baseline capacity", cell: (r) => num1.format(r.baselineCapacity) },
    { label: "Extra variations per month", cell: (r) => signed(r.extraVariations, num1.format) },
    { label: "Incremental media spend", note: "assumed", cell: (r) => egp.format(r.incrementalSpendEgp) },
    { label: "Return at marginal ROMI", cell: (r) => egp.format(r.grossReturnEgp) },
    { label: "− AI/API cost", cell: (r) => egp.format(r.aiCostEgp) },
    { label: "− Other running costs", cell: (r) => egp.format(r.opexEgp) },
    { label: "− Onboarding (spread)", cell: (r) => egp.format(r.onboardingEgp) },
    { label: "Potential net incremental EGP / month", cell: (r) => signed(r.netEgp, (x) => egp.format(x)), strong: true, tone: (r) => r.netEgp < 0 },
    { label: "Break-even marginal ROMI", note: "ROMI needed to cover costs", cell: (r) => (r.breakEvenRomi === null ? "n/a" : `${(r.breakEvenRomi * 100).toFixed(1)}%`) },
  ];
  return (
    <section aria-labelledby="results-title" className={styles.results}>
      <div className={styles.bannerHead}>
        <Badge tone="forecast">Forecast</Badge>
        <h3 id="results-title" className={styles.title}><Icon icon={Rocket01Icon} size={18} />Projected monthly outcome</h3>
      </div>
      <div className={styles.cards}>
        {results.map((r) => (
          <div key={r.id} className={`${styles.card} ${r.netEgp < 0 ? styles.cardNeg : styles.cardPos}`}>
            <p className={styles.cardLabel}>{LABEL[r.id]}</p>
            <p className={styles.cardValue}>{signed(r.netEgp, (x) => egp.format(x))}</p>
            <p className={styles.cardNote}>{r.netEgp < 0 ? "does not cover costs" : "net per month"} · {num1.format(r.capacity)} variations · break-even ROMI {r.breakEvenRomi === null ? "n/a" : `${(r.breakEvenRomi * 100).toFixed(1)}%`}</p>
          </div>
        ))}
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption className="sr-only">Forecast by scenario, based on the assumptions above (baseline {inputs.baselineMin} minutes)</caption>
          <thead>
            <tr><th scope="col">Per month</th>{results.map((r) => <th key={r.id} scope="col" className={styles.num}>{LABEL[r.id]}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className={row.strong ? styles.strong : undefined}>
                <th scope="row">{row.label}{row.note && <span className={styles.rowNote}> · {row.note}</span>}</th>
                {results.map((r) => <td key={r.id} className={`${styles.num} ${row.tone?.(r) ? styles.negative : ""}`}>{row.cell(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.foot}>Forecast only. A negative result means the assumptions do not cover the costs; the break-even ROMI shows how far they are from doing so.</p>
    </section>
  );
}
