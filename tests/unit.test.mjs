// Unit tests for the pure analytics and scenario modules. Run: npm run test:unit
// Fixtures below are synthetic inputs to the aggregator ONLY; they are never shown in the product.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport, csvCell, eventsCsv, sessionsCsv } from "../src/lib/analytics.ts";
import { computeScenario, DEFAULT_INPUTS, validateInputs } from "../src/lib/scenarios.ts";
import { generateConcepts, ANGLES } from "../src/lib/mock-provider.ts";
import { conceptValid, editSize, initialStatus, selectedConcepts } from "../src/lib/concepts.ts";
import { MockProvider } from "../src/lib/server/ai/mock.ts";
import { overlap, validateConcepts } from "../src/lib/server/ai/validate.ts";

let t = 0;
const ev = (sid, type, props = {}) => ({ ts: new Date(1_700_000_000_000 + t++ * 1000).toISOString(), sid, type, ...props });
const start = (sid, origin = "interactive") => ev(sid, "session_started", { origin });
const rendered = (sid, variant, durationMs = 8000) => ev(sid, "render_completed", { variant, ok: true, durationMs });
const time = (sid, activeMs, wait = 0) => ev(sid, "session_time", { activeMs, waitUploadMs: 0, waitAiMs: 0, waitRenderMs: wait });

test("generating or rendering never counts as accepted", () => {
  const r = buildReport([start("a"), ev("a", "variations_generated", { count: 3, provider: "mock" }), rendered("a", "statement"), rendered("a", "editorial")], "interactive");
  assert.equal(r.acceptance.accepted, 0);
  assert.equal(r.funnel.rendered, 2);
  assert.equal(r.funnel.variationsGenerated, 3);
  assert.equal(r.humanTime.minutesPerAccepted, null);
  assert.equal(r.acceptance.firstPassRate, null);
});

test("a decision on a video that was never rendered is ignored", () => {
  const r = buildReport([start("a"), ev("a", "variant_accepted", { variant: "statement" })], "interactive");
  assert.equal(r.acceptance.accepted, 0);
});

test("first-pass acceptance: re-render or edit removes first-pass status; rejections count against it", () => {
  const events = [
    start("a"),
    rendered("a", "statement"), ev("a", "variant_accepted", { variant: "statement" }), // first pass
    rendered("a", "editorial"), ev("a", "variant_rejected", { variant: "editorial" }), // rejected
    rendered("a", "spotlight"), ev("a", "variant_accepted", { variant: "spotlight" }),
    ev("a", "variant_edited", { variant: "spotlight", fields: "hook" }), // edit withdraws the decision
    rendered("a", "spotlight"), ev("a", "variant_accepted", { variant: "spotlight" }), // accepted, but second render
  ];
  const r = buildReport(events, "interactive");
  assert.equal(r.acceptance.accepted, 2);
  assert.equal(r.acceptance.rejected, 1);
  assert.equal(r.acceptance.firstPassAccepted, 1);
  assert.equal(r.acceptance.decided, 3);
  assert.equal(r.acceptance.firstPassRate, 0.3333);
  assert.equal(r.funnel.edited, 1);
});

test("editing an accepted variant withdraws the acceptance until it is decided again", () => {
  const r = buildReport([start("a"), rendered("a", "statement"), ev("a", "variant_accepted", { variant: "statement" }), ev("a", "variant_edited", { variant: "statement", fields: "cta" })], "interactive");
  assert.equal(r.acceptance.accepted, 0);
  assert.equal(r.acceptance.undecided, 1);
});

test("human time per accepted uses only timed sessions and divides by their accepted count", () => {
  const events = [
    start("a"), rendered("a", "statement"), ev("a", "variant_accepted", { variant: "statement" }), rendered("a", "editorial"), ev("a", "variant_accepted", { variant: "editorial" }), time("a", 6 * 60_000, 20_000),
    start("b", "scripted"), rendered("b", "statement"), ev("b", "variant_accepted", { variant: "statement" }), ev("b", "session_time", { activeMs: null }),
  ];
  const interactive = buildReport(events, "interactive");
  assert.equal(interactive.humanTime.minutesPerAccepted, 3); // 6 min / 2 accepted
  assert.equal(interactive.humanTime.waitSec, 20);
  const all = buildReport(events, "all");
  assert.equal(all.acceptance.accepted, 3);
  assert.equal(all.humanTime.minutesPerAccepted, 3); // the scripted session has no measured human time and is excluded from the numerator AND denominator
  assert.equal(buildReport(events, "scripted").humanTime.minutesPerAccepted, null);
});

test("cumulative session_time: the latest snapshot wins", () => {
  const r = buildReport([start("a"), time("a", 10_000), time("a", 25_000)], "interactive");
  assert.equal(r.humanTime.activeSec, 25);
});

test("rendering stats and failure rate", () => {
  const r = buildReport([start("a"), rendered("a", "statement", 6000), rendered("a", "editorial", 10000), ev("a", "render_completed", { variant: "spotlight", ok: false, errorKind: "unexpected" })], "interactive");
  assert.equal(r.rendering.attempts, 3);
  assert.equal(r.rendering.failed, 1);
  assert.equal(r.rendering.failureRate, 0.3333);
  assert.equal(r.rendering.avgSec, 8);
  assert.equal(r.rendering.maxSec, 10);
});

test("AI usage: providers, cache hits, tokens and estimated cost; mock is free", () => {
  const g = (props) => ev("a", "variations_generated", { count: 3, ...props });
  const r = buildReport([
    start("a"),
    g({ provider: "mock", cached: false }),
    g({ provider: "gemini", cached: false, inputTokens: 1000, outputTokens: 400, thoughtTokens: 100, estimatedCostUsd: 0.00085 }),
    g({ provider: "gemini", cached: true, estimatedCostUsd: 0 }),
    g({ provider: "mock", cached: false, fallback: "quota" }),
    rendered("a", "statement"), ev("a", "variant_accepted", { variant: "statement" }),
  ], "interactive");
  assert.deepEqual(r.ai.byProvider, { mock: 2, gemini: 2 });
  assert.equal(r.ai.cached, 1);
  assert.equal(r.ai.fallbacks, 1);
  assert.equal(r.ai.tokens.input, 1000);
  assert.equal(r.ai.estCostUsd, 0.00085);
  assert.equal(r.ai.costPerAcceptedUsd, 0.00085);
});

test("exports count only on rendered variants; scope filters sessions", () => {
  const events = [start("a"), rendered("a", "statement"), ev("a", "variant_exported", { variant: "statement" }), ev("a", "variant_exported", { variant: "editorial" }), start("b", "scripted"), rendered("b", "statement")];
  assert.equal(buildReport(events, "interactive").funnel.exported, 1);
  assert.equal(buildReport(events, "scripted").funnel.rendered, 1);
  assert.equal(buildReport(events, "all").funnel.rendered, 2);
});

test("CSV escaping and formula-injection guard", () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-3), "-3"); // numbers are not text
  const r = buildReport([start("a"), rendered("a", "statement")], "interactive");
  const rows = sessionsCsv(r).trim().split("\r\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].split(",").length, rows[1].split(",").length);
  assert.ok(eventsCsv([start("a")]).startsWith("timestamp,session_id,event"));
});

test("scenario maths is internally consistent", () => {
  const i = DEFAULT_INPUTS;
  assert.equal(validateInputs(i), null);
  const base = computeScenario(i, "base");
  assert.equal(base.effectiveMin, 96);
  assert.ok(Math.abs(base.baselineCapacity - (80 * 60) / 180) < 1e-9);
  assert.ok(Math.abs(base.capacity - ((80 - 2) * 60) / 96) < 1e-9);
  assert.ok(Math.abs(base.extraVariations - (base.capacity - base.baselineCapacity)) < 1e-9);
  assert.ok(Math.abs(base.netEgp - (base.grossReturnEgp - base.totalCostsEgp)) < 1e-6);
  // At break-even ROMI the net result is zero.
  const be = computeScenario({ ...i, scenarios: { ...i.scenarios, base: { ...i.scenarios.base, romi: base.breakEvenRomi } } }, "base");
  assert.ok(Math.abs(be.netEgp) < 1e-6);
});

test("a scenario slower than baseline shows negative extra capacity and zero spend, never invented upside", () => {
  const i = { ...DEFAULT_INPUTS, scenarios: { ...DEFAULT_INPUTS.scenarios, conservative: { improvedMin: 400, romi: 0.5 } } };
  const c = computeScenario(i, "conservative");
  assert.ok(c.extraVariations < 0);
  assert.equal(c.incrementalSpendEgp, 0);
  assert.equal(c.grossReturnEgp, 0);
  assert.ok(c.netEgp < 0);
  assert.equal(c.breakEvenRomi, null);
});

test("input validation", () => {
  assert.match(validateInputs({ ...DEFAULT_INPUTS, baselineMin: 0 }), /Baseline/);
  assert.match(validateInputs({ ...DEFAULT_INPUTS, aiCostUsd: -1 }), /AI cost/);
  assert.match(validateInputs({ ...DEFAULT_INPUTS, hoursPerMonth: Number.NaN }), /Monthly hours/);
  assert.match(validateInputs({ ...DEFAULT_INPUTS, onboardingHours: 1000 }), /Onboarding/);
});

// ---------- concepts: generation, validation, selection ----------

const brief = { script: "Our socks slip. Watch this runner fix it.", product: "SockLock — anti-slip sports socks that stay put", cta: "Shop now" };

test("3, 6 and 9 concepts: complete fields, unique ids, distinct angles and genuinely different copy", () => {
  for (const count of [3, 6, 9]) {
    const list = generateConcepts({ ...brief, count });
    assert.equal(list.length, count);
    assert.equal(new Set(list.map((c) => c.id)).size, count);
    assert.equal(new Set(list.map((c) => c.angle)).size, count);
    for (const c of list) {
      for (const f of ["angle", "hook", "openingLine", "onScreenText", "cta", "rationale"]) assert.ok(c[f].trim(), `${c.id}.${f}`);
      assert.ok(conceptValid(c), `${c.id} within limits`);
    }
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        assert.ok(overlap(list[i].hook, list[j].hook) <= 0.5, `hooks ${i}/${j} overlap`);
        assert.ok(overlap(list[i].openingLine, list[j].openingLine) <= 0.5, `opening lines ${i}/${j} overlap`);
      }
    }
  }
  assert.equal(generateConcepts({ ...brief }).length, 6, "default is 6");
  assert.deepEqual(generateConcepts({ ...brief, count: 3 }).map((c) => c.angle), ANGLES.slice(0, 3).map((a) => a.label));
  assert.deepEqual(generateConcepts({ ...brief, count: 9 }).slice(0, 3), generateConcepts({ ...brief, count: 3 }), "the first three concepts do not change with the count");
  assert.deepEqual(new Set(generateConcepts({ ...brief, count: 9 }).map((c) => c.template)), new Set(["statement", "editorial", "spotlight"]));
});

test("the mock provider's wire output passes the same validator the AI output goes through", async () => {
  for (const count of [3, 6, 9]) {
    const out = await new MockProvider().generate({ ...brief, brand: "SockLock", count });
    const parsed = validateConcepts(out.json, `${brief.product}\n${brief.script}\n${brief.cta}`, count);
    assert.deepEqual(parsed.problems, []);
    assert.equal(Object.keys(parsed.ok).length, count);
  }
});

test("validator replaces paraphrased, duplicated, over-long and unsupported concepts instead of trusting the model", () => {
  const facts = `${brief.product}\n${brief.script}\n${brief.cta}`;
  const base = generateConcepts({ ...brief, count: 3 });
  const wire = base.map((c, i) => ({ angle: ["pain", "demo", "benefit"][i], hook: c.hook, openingLine: c.openingLine, onScreenText: c.onScreenText, cta: c.cta, rationale: c.rationale }));
  wire[1].hook = `${wire[0].hook} again`; // reworded duplicate of concept 1
  wire[2].onScreenText = "Best socks, 50% off"; // superlative + discount + invented number
  const r = validateConcepts(JSON.stringify({ concepts: wire }), facts, 3);
  assert.deepEqual(Object.keys(r.ok), ["c1"]);
  assert.equal(r.problems.length, 2);
  assert.match(r.problems.join(" "), /repeats another concept/);
  assert.match(r.problems.join(" "), /unsupported claims/);
  assert.equal(validateConcepts("not json", facts, 3).problems.length, 1);
  assert.ok(validateConcepts(JSON.stringify({ concepts: wire.slice(0, 2) }), facts, 3).problems.some((p) => /got 0/.test(p)), "a missing angle is reported");
  assert.ok(overlap("Watch it work", "Watch it work today") > 0.7);
  assert.ok(overlap("Watch it work", "Stop scrolling now") < 0.2);
});

test("a new batch starts with the first three concepts selected for video; the rest can be switched on", () => {
  const list = generateConcepts({ ...brief, count: 6 });
  const status = initialStatus(list, 3);
  assert.deepEqual(selectedConcepts(list, status).map((c) => c.id), ["c1", "c2", "c3"]);
  assert.deepEqual(selectedConcepts(list, { ...status, c5: "approved", c1: "rejected" }).map((c) => c.id), ["c2", "c3", "c5"], "list order, whatever the toggle order");
  assert.equal(selectedConcepts(generateConcepts({ ...brief, count: 3 }), initialStatus(generateConcepts({ ...brief, count: 3 }), 3)).length, 3);
});

test("edit size counts what actually changed, not the length difference", () => {
  assert.equal(editSize("Stop scrolling", "Stop scrolling"), 0);
  assert.equal(editSize("Watch it work", "Watch it fly"), 4); // "work" -> "fly"
  assert.equal(editSize("abc", "abcdef"), 3);
  assert.equal(editSize("abcdef", ""), 6);
  assert.equal(editSize("same length", "same lengtx"), 1);
});

// ---------- concept metrics ----------

const gen = (sid, count = 6, extra = {}) => ev(sid, "variations_generated", { count, provider: "mock", cached: false, ...extra });
const approve = (sid, variant) => ev(sid, "concept_approved", { variant });
const reject = (sid, variant) => ev(sid, "concept_rejected", { variant });
const edit = (sid, variant, fields, chars) => ev(sid, "variant_edited", { variant, fields, chars });
const split = (sid, activeMs, ideationMs) => ev(sid, "session_time", { activeMs, activeIdeationMs: ideationMs, waitUploadMs: 0, waitAiMs: 4000, waitRenderMs: 9000 });

test("concept metrics: approvals, edit effort, unedited approvals and cost per approved concept", () => {
  const r = buildReport([
    start("a"), gen("a", 6, { inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.006, provider: "gemini" }),
    approve("a", "c1"), approve("a", "c2"), approve("a", "c3"), reject("a", "c4"), reject("a", "c5"),
    edit("a", "c2", "hook,openingLine", 14), edit("a", "c2", "cta", 3),
    edit("a", "c4", "segment", 0), // not a copy edit: must not count as an edited concept
    rendered("a", "c1"), ev("a", "variant_accepted", { variant: "c1" }),
    split("a", 600_000, 420_000),
  ], "interactive");
  const i = r.ideation;
  assert.equal(i.generated, 6);
  assert.equal(i.approved, 4, "concepts start approved: 6 generated - 2 rejected");
  assert.equal(i.rejected, 2);
  assert.equal(i.approvalRate, 0.6667);
  assert.equal(i.edited, 1);
  assert.equal(i.editChars, 17);
  assert.equal(i.editCharsPerApproved, 4.3);
  assert.equal(i.approvedUnedited, 3);
  assert.equal(i.costPerApprovedUsd, 0.0015);
  assert.equal(r.ai.costPerAcceptedUsd, 0.006, "cost per accepted video is a separate number");
  assert.equal(r.acceptance.accepted, 1, "approving a concept never counts as an accepted video");
  assert.equal(r.rows[0].conceptsApproved, 4);
  assert.equal(r.rows[0].editChars, 17);
});

test("ideation time is separated from video time and rendering/AI waiting", () => {
  const r = buildReport([start("a"), gen("a", 3), approve("a", "c1"), approve("a", "c2"), split("a", 600_000, 420_000)], "interactive");
  const i = r.ideation;
  assert.equal(i.activeSec, 420);
  assert.equal(i.videoReviewSec, 180);
  assert.equal(i.aiWaitSec, 4);
  assert.equal(i.minutesPerApproved, 2.33); // 7 min / 3 approved (nothing rejected)
  assert.equal(r.humanTime.activeSec, 600, "total hands-on time is unchanged by the split");
  // A session without the split (older log) must not be silently counted as all-video or all-ideas.
  const old = buildReport([start("b"), gen("b", 3), approve("b", "c1"), ev("b", "session_time", { activeMs: 60_000, waitUploadMs: 0, waitAiMs: 0, waitRenderMs: 0 })], "interactive");
  assert.equal(old.ideation.sessions, 0);
  assert.equal(old.ideation.minutesPerApproved, null);
  assert.equal(old.rows[0].ideationSec, null);
});

test("regenerating concepts starts a fresh batch: old approvals and edits do not leak into the new concepts", () => {
  const r = buildReport([
    start("a"), gen("a", 3), approve("a", "c1"), edit("a", "c1", "hook", 9),
    gen("a", 3), // regenerated: c1 is a different concept now
    reject("a", "c1"), approve("a", "c2"),
  ], "interactive");
  assert.equal(r.ideation.generated, 6);
  assert.equal(r.ideation.approved, 5); // 6 generated - 1 rejected (the second batch's c1)
  assert.equal(r.ideation.rejected, 1);
  assert.equal(r.ideation.edited, 1);
  assert.equal(r.ideation.approvedUnedited, 4); // the first batch's c1 was edited; the other four were kept as generated
});

test("a concept edit does not withdraw the concept approval, but does withdraw a video decision", () => {
  const r = buildReport([start("a"), gen("a", 3), approve("a", "c1"), rendered("a", "c1"), ev("a", "variant_accepted", { variant: "c1" }), edit("a", "c1", "hook", 4)], "interactive");
  assert.equal(r.ideation.approved, 3, "editing never rejects a concept");
  assert.equal(r.acceptance.accepted, 0);
  assert.equal(r.acceptance.undecided, 1);
});

test("sessions CSV carries the concept columns", () => {
  const r = buildReport([start("a"), gen("a", 3), approve("a", "c1")], "interactive");
  const [head, row] = sessionsCsv(r).trim().split("\r\n");
  assert.ok(head.includes("concepts_approved") && head.includes("ideation_seconds") && head.includes("edit_chars"));
  assert.equal(head.split(",").length, row.split(",").length);
});
