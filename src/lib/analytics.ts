/**
 * Pure analytics model: event shapes, aggregation and CSV. No Node or browser APIs, so it is shared by the
 * server (reads the event log) and the unit tests.
 *
 * Rules that keep the numbers honest:
 *  - Generating ideas never counts as success. A concept is approved when it is switched on for video (the first three
 *    start on, the rest are recorded as rejected until switched on), so approved = generated - rejected. A rendered video is "accepted" only by an explicit click after rendering.
 *    The two are counted separately and never mixed.
 *  - Editing a variant, or re-rendering it, withdraws an earlier decision: the accepted video must match the copy.
 *  - Human time comes only from sessions where a person's activity was actually measured (scripted runs have none).
 *  - Costs are estimates from list prices and reported tokens, never billed amounts.
 */

export const EVENT_TYPES = [
  "session_started",
  "session_completed",
  "session_time",
  "source_uploaded",
  "variations_generated",
  "variant_edited",
  "concept_approved",
  "concept_rejected",
  "render_completed",
  "variant_accepted",
  "variant_rejected",
  "variant_exported",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Events a browser may report. The rest are observed (and recorded) by the server itself. */
export const CLIENT_EVENT_TYPES: readonly EventType[] = [
  "session_started",
  "session_completed",
  "session_time",
  "variant_edited",
  "concept_approved",
  "concept_rejected",
  "variant_accepted",
  "variant_rejected",
  "variant_exported",
];

export type Scalar = string | number | boolean | null;
export interface AnalyticsEvent {
  /** ISO timestamp assigned by the server on receipt (one clock, so no client skew). */
  ts: string;
  sid: string;
  type: EventType;
  [prop: string]: Scalar;
}

export type Origin = "interactive" | "scripted";
export type Scope = "interactive" | "scripted" | "all";
export const SCOPES: readonly Scope[] = ["interactive", "scripted", "all"];

export interface SessionRow {
  sid: string;
  origin: Origin | "unknown";
  startedAt: string | null;
  completed: boolean;
  /** Hands-on seconds; null when no human activity was measured for this session. */
  activeSec: number | null;
  /** Hands-on seconds spent on briefing, generating and reviewing concepts (before rendering). Null when not measured. */
  ideationSec: number | null;
  waitSec: number;
  sources: number;
  variationsGenerated: number;
  aiRequests: number;
  providers: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  rendersOk: number;
  rendersFailed: number;
  renderSec: number;
  variantsEdited: number;
  conceptsApproved: number;
  conceptsRejected: number;
  conceptsEdited: number;
  editChars: number;
  accepted: number;
  rejected: number;
  firstPassAccepted: number;
  exported: number;
}

export interface InsightsReport {
  scope: Scope;
  generatedAt: string;
  sessions: { started: number; completed: number; timed: number };
  funnel: { sources: number; variationsGenerated: number; edited: number; rendered: number; accepted: number; rejected: number; exported: number };
  acceptance: { accepted: number; rejected: number; undecided: number; firstPassAccepted: number; decided: number; firstPassRate: number | null };
  humanTime: { activeSec: number; waitSec: number; timedSessions: number; acceptedInTimedSessions: number; minutesPerAccepted: number | null };
  /** Idea work (brief, generate, review concepts) measured apart from rendering and video review. */
  ideation: {
    /** Hands-on seconds on concepts, in sessions that recorded the split. */
    activeSec: number;
    /** Hands-on seconds on rendered videos (watching and deciding), in the same sessions. */
    videoReviewSec: number;
    /** AI waiting seconds (machine time, not hands-on). */
    aiWaitSec: number;
    /** Machine seconds spent rendering (server-measured). */
    renderWaitSec: number;
    sessions: number;
    generated: number;
    approved: number;
    rejected: number;
    /** approved / generated */
    approvalRate: number | null;
    /** Concepts that were edited before or after a decision. */
    edited: number;
    /** Characters changed while editing concept copy (insertions and deletions, not keystrokes). */
    editChars: number;
    /** Average characters changed per approved concept. */
    editCharsPerApproved: number | null;
    /** Approved without any edit. */
    approvedUnedited: number;
    /** Hands-on minutes on concepts per approved concept, in sessions that recorded the split. */
    minutesPerApproved: number | null;
    /** Estimated AI cost / approved concepts (all sessions in scope). */
    costPerApprovedUsd: number | null;
  };
  rendering: { attempts: number; ok: number; failed: number; failureRate: number | null; avgSec: number | null; maxSec: number | null; totalSec: number };
  ai: {
    requests: number;
    byProvider: { mock: number; gemini: number };
    cached: number;
    fallbacks: number;
    tokens: { input: number; output: number; thought: number };
    estCostUsd: number;
    costPerAcceptedUsd: number | null;
  };
  rows: SessionRow[];
}

interface VariantRec {
  renders: number;
  decision: "pending" | "accepted" | "rejected";
  rendersAtDecision: number;
  edited: boolean;
  /** Copy (not just segment or framing) was changed. */
  copyEdited: boolean;
  editChars: number;
  concept: "pending" | "approved" | "rejected";
  exported: boolean;
}

interface SessionRec {
  sid: string;
  origin: Origin | "unknown";
  startedAt: string | null;
  completed: boolean;
  activeMs: number | null;
  /** Null when the session did not record the ideation/rendering split. */
  ideationMs: number | null;
  waitMs: number;
  waitAiMs: number;
  waitRenderClientMs: number;
  /** Increments with every generation, so regenerated concepts never mix with the previous batch. */
  batch: number;
  sources: number;
  variations: number;
  ai: { requests: number; mock: number; gemini: number; cached: number; fallbacks: number; input: number; output: number; thought: number; cost: number };
  renderOk: number;
  renderFailed: number;
  renderMs: number;
  renderMaxMs: number;
  variants: Map<string, VariantRec>;
}

const num = (v: Scalar | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function newSession(sid: string): SessionRec {
  return {
    sid, origin: "unknown", startedAt: null, completed: false, activeMs: null, ideationMs: null, waitMs: 0, waitAiMs: 0, waitRenderClientMs: 0, batch: 0, sources: 0, variations: 0,
    ai: { requests: 0, mock: 0, gemini: 0, cached: 0, fallbacks: 0, input: 0, output: 0, thought: 0, cost: 0 },
    renderOk: 0, renderFailed: 0, renderMs: 0, renderMaxMs: 0, variants: new Map(),
  };
}

const variantOf = (s: SessionRec, id: Scalar | undefined): VariantRec | null => {
  if (typeof id !== "string" || !id) return null;
  const key = `${s.batch}/${id}`;
  let v = s.variants.get(key);
  if (!v) {
    v = { renders: 0, decision: "pending", rendersAtDecision: 0, edited: false, copyEdited: false, editChars: 0, concept: "pending", exported: false };
    s.variants.set(key, v);
  }
  return v;
};

const COPY_KEYS = ["hook", "openingLine", "onScreenText", "cta"];

/** Replays the event log in file order (the order the server received events). */
function replay(events: readonly AnalyticsEvent[]): SessionRec[] {
  const sessions = new Map<string, SessionRec>();
  for (const e of events) {
    let s = sessions.get(e.sid);
    if (!s) sessions.set(e.sid, (s = newSession(e.sid)));
    switch (e.type) {
      case "session_started":
        if (e.origin === "interactive" || e.origin === "scripted") s.origin = e.origin;
        s.startedAt ??= e.ts;
        break;
      case "session_completed":
        s.completed = true;
        break;
      case "session_time":
        // Cumulative snapshots: the latest wins. A null activeMs means "nobody was measured".
        s.activeMs = typeof e.activeMs === "number" && Number.isFinite(e.activeMs) ? Math.max(0, e.activeMs) : null;
        s.waitMs = num(e.waitUploadMs) + num(e.waitAiMs) + num(e.waitRenderMs);
        s.waitAiMs = num(e.waitAiMs);
        s.waitRenderClientMs = num(e.waitRenderMs);
        s.ideationMs = typeof e.activeIdeationMs === "number" && Number.isFinite(e.activeIdeationMs) && s.activeMs !== null ? Math.min(Math.max(0, e.activeIdeationMs), s.activeMs) : null;
        break;
      case "source_uploaded":
        s.sources++;
        break;
      case "variations_generated": {
        s.batch++;
        s.variations += num(e.count);
        s.ai.requests++;
        if (e.cached === true) s.ai.cached++;
        if (e.provider === "gemini") s.ai.gemini++;
        else s.ai.mock++;
        if (typeof e.fallback === "string" && e.fallback) s.ai.fallbacks++;
        s.ai.input += num(e.inputTokens);
        s.ai.output += num(e.outputTokens);
        s.ai.thought += num(e.thoughtTokens);
        s.ai.cost += num(e.estimatedCostUsd);
        break;
      }
      case "variant_edited": {
        const v = variantOf(s, e.variant);
        if (v) {
          v.edited = true;
          v.decision = "pending"; // the earlier video decision was about different copy
          if (typeof e.fields === "string" && e.fields.split(",").some((f) => COPY_KEYS.includes(f))) v.copyEdited = true;
          v.editChars += num(e.chars);
        }
        break;
      }
      case "concept_approved":
      case "concept_rejected": {
        const v = variantOf(s, e.variant);
        if (v) v.concept = e.type === "concept_approved" ? "approved" : "rejected";
        break;
      }
      case "render_completed": {
        if (e.ok === true) {
          s.renderOk++;
          const ms = num(e.durationMs);
          s.renderMs += ms;
          s.renderMaxMs = Math.max(s.renderMaxMs, ms);
          const v = variantOf(s, e.variant);
          if (v) {
            v.renders++;
            v.decision = "pending"; // a new video needs a new decision
          }
        } else {
          s.renderFailed++;
        }
        break;
      }
      case "variant_accepted":
      case "variant_rejected": {
        const v = variantOf(s, e.variant);
        if (v && v.renders > 0) {
          // A decision only counts on a successfully rendered video.
          v.decision = e.type === "variant_accepted" ? "accepted" : "rejected";
          v.rendersAtDecision = v.renders;
        }
        break;
      }
      case "variant_exported": {
        const v = variantOf(s, e.variant);
        if (v && v.renders > 0) v.exported = true;
        break;
      }
    }
  }
  return [...sessions.values()];
}

const inScope = (s: SessionRec, scope: Scope) => scope === "all" || s.origin === scope;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function buildReport(events: readonly AnalyticsEvent[], scope: Scope, now = new Date()): InsightsReport {
  const sessions = replay(events).filter((s) => inScope(s, scope));
  const rows: SessionRow[] = [];
  const r: InsightsReport = {
    scope,
    generatedAt: now.toISOString(),
    sessions: { started: 0, completed: 0, timed: 0 },
    funnel: { sources: 0, variationsGenerated: 0, edited: 0, rendered: 0, accepted: 0, rejected: 0, exported: 0 },
    acceptance: { accepted: 0, rejected: 0, undecided: 0, firstPassAccepted: 0, decided: 0, firstPassRate: null },
    humanTime: { activeSec: 0, waitSec: 0, timedSessions: 0, acceptedInTimedSessions: 0, minutesPerAccepted: null },
    rendering: { attempts: 0, ok: 0, failed: 0, failureRate: null, avgSec: null, maxSec: null, totalSec: 0 },
    ai: { requests: 0, byProvider: { mock: 0, gemini: 0 }, cached: 0, fallbacks: 0, tokens: { input: 0, output: 0, thought: 0 }, estCostUsd: 0, costPerAcceptedUsd: null },
    ideation: {
      activeSec: 0, videoReviewSec: 0, aiWaitSec: 0, renderWaitSec: 0, sessions: 0, generated: 0, approved: 0, rejected: 0, approvalRate: null,
      edited: 0, editChars: 0, editCharsPerApproved: null, approvedUnedited: 0, minutesPerApproved: null, costPerApprovedUsd: null,
    },
    rows,
  };
  const id = r.ideation;
  let splitApproved = 0;
  let renderMs = 0;
  let renderMax = 0;

  for (const s of sessions) {
    let accepted = 0, rejected = 0, firstPass = 0, edited = 0, exported = 0, rendered = 0;
    let cRejected = 0, cEdited = 0, cEditChars = 0, cEditedKept = 0;
    for (const v of s.variants.values()) {
      if (v.concept === "rejected") cRejected++;
      else if (v.copyEdited) cEditedKept++;
      if (v.copyEdited) cEdited++;
      cEditChars += v.editChars;
      if (v.edited) edited++;
      if (v.renders > 0) rendered++;
      if (v.exported) exported++;
      if (v.decision === "accepted") {
        accepted++;
        if (v.rendersAtDecision === 1) firstPass++;
      } else if (v.decision === "rejected") rejected++;
    }
    // Approved = switched on for video = generated - rejected.
    const cApproved = Math.max(0, s.variations - cRejected);
    const cApprovedUnedited = Math.max(0, cApproved - cEditedKept);
    const undecided = [...s.variants.values()].filter((v) => v.renders > 0 && v.decision === "pending").length;
    if (s.startedAt) r.sessions.started++;
    if (s.completed) r.sessions.completed++;
    r.funnel.sources += s.sources;
    r.funnel.variationsGenerated += s.variations;
    r.funnel.edited += edited;
    r.funnel.rendered += rendered;
    r.funnel.accepted += accepted;
    r.funnel.rejected += rejected;
    r.funnel.exported += exported;
    r.acceptance.undecided += undecided;
    r.acceptance.firstPassAccepted += firstPass;
    if (s.activeMs !== null) {
      r.sessions.timed++;
      r.humanTime.activeSec += s.activeMs / 1000;
      r.humanTime.acceptedInTimedSessions += accepted;
    }
    r.humanTime.waitSec += s.waitMs / 1000;
    id.generated += s.variations;
    id.approved += cApproved;
    id.rejected += cRejected;
    id.edited += cEdited;
    id.editChars += cEditChars;
    id.approvedUnedited += cApprovedUnedited;
    id.aiWaitSec += s.waitAiMs / 1000;
    id.renderWaitSec += s.renderMs / 1000;
    if (s.ideationMs !== null && s.activeMs !== null) {
      id.sessions++;
      id.activeSec += s.ideationMs / 1000;
      id.videoReviewSec += (s.activeMs - s.ideationMs) / 1000;
      splitApproved += cApproved;
    }
    r.rendering.ok += s.renderOk;
    r.rendering.failed += s.renderFailed;
    renderMs += s.renderMs;
    renderMax = Math.max(renderMax, s.renderMaxMs);
    r.ai.requests += s.ai.requests;
    r.ai.byProvider.mock += s.ai.mock;
    r.ai.byProvider.gemini += s.ai.gemini;
    r.ai.cached += s.ai.cached;
    r.ai.fallbacks += s.ai.fallbacks;
    r.ai.tokens.input += s.ai.input;
    r.ai.tokens.output += s.ai.output;
    r.ai.tokens.thought += s.ai.thought;
    r.ai.estCostUsd += s.ai.cost;

    rows.push({
      sid: s.sid, origin: s.origin, startedAt: s.startedAt, completed: s.completed,
      activeSec: s.activeMs === null ? null : round(s.activeMs / 1000, 1),
      ideationSec: s.ideationMs === null ? null : round(s.ideationMs / 1000, 1),
      waitSec: round(s.waitMs / 1000, 1),
      sources: s.sources, variationsGenerated: s.variations, aiRequests: s.ai.requests,
      providers: [s.ai.mock ? "mock" : "", s.ai.gemini ? "gemini" : ""].filter(Boolean).join("+"),
      inputTokens: s.ai.input, outputTokens: s.ai.output + s.ai.thought, estCostUsd: round(s.ai.cost, 6),
      rendersOk: s.renderOk, rendersFailed: s.renderFailed, renderSec: round(s.renderMs / 1000, 1),
      variantsEdited: edited, conceptsApproved: cApproved, conceptsRejected: cRejected, conceptsEdited: cEdited, editChars: cEditChars, accepted, rejected, firstPassAccepted: firstPass, exported,
    });
  }

  const a = r.acceptance;
  a.accepted = r.funnel.accepted;
  a.rejected = r.funnel.rejected;
  a.decided = a.accepted + a.rejected;
  a.firstPassRate = a.decided ? round(a.firstPassAccepted / a.decided, 4) : null;

  r.humanTime.timedSessions = r.sessions.timed;
  r.humanTime.activeSec = round(r.humanTime.activeSec, 1);
  r.humanTime.waitSec = round(r.humanTime.waitSec, 1);
  r.humanTime.minutesPerAccepted = r.humanTime.acceptedInTimedSessions
    ? round(r.humanTime.activeSec / 60 / r.humanTime.acceptedInTimedSessions, 2)
    : null;

  const rd = r.rendering;
  rd.attempts = rd.ok + rd.failed;
  rd.failureRate = rd.attempts ? round(rd.failed / rd.attempts, 4) : null;
  rd.avgSec = rd.ok ? round(renderMs / rd.ok / 1000, 2) : null;
  rd.maxSec = rd.ok ? round(renderMax / 1000, 2) : null;
  rd.totalSec = round(renderMs / 1000, 1);

  id.approvalRate = id.generated ? round(id.approved / id.generated, 4) : null;
  id.editCharsPerApproved = id.approved ? round(id.editChars / id.approved, 1) : null;
  id.minutesPerApproved = splitApproved ? round(id.activeSec / 60 / splitApproved, 2) : null;
  id.activeSec = round(id.activeSec, 1);
  id.videoReviewSec = round(id.videoReviewSec, 1);
  id.aiWaitSec = round(id.aiWaitSec, 1);
  id.renderWaitSec = round(id.renderWaitSec, 1);
  r.ai.estCostUsd = round(r.ai.estCostUsd, 6);
  id.costPerApprovedUsd = id.approved ? round(r.ai.estCostUsd / id.approved, 6) : null;
  r.ai.costPerAcceptedUsd = r.funnel.accepted ? round(r.ai.estCostUsd / r.funnel.accepted, 6) : null;
  return r;
}

// ---------- CSV ----------

/** RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet could execute as a formula. */
export function csvCell(v: Scalar | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (header: string[], rows: Scalar[][]) => [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function sessionsCsv(report: InsightsReport): string {
  const header = ["session_id", "origin", "started_at", "completed", "active_seconds", "ideation_seconds", "waiting_seconds", "sources", "variations_generated", "ai_requests", "ai_providers", "input_tokens", "output_tokens", "est_cost_usd", "renders_ok", "renders_failed", "render_seconds", "variants_edited", "concepts_approved", "concepts_rejected", "concepts_edited", "edit_chars", "accepted", "rejected", "first_pass_accepted", "exported"];
  return csv(header, report.rows.map((x) => [x.sid, x.origin, x.startedAt, x.completed, x.activeSec, x.ideationSec, x.waitSec, x.sources, x.variationsGenerated, x.aiRequests, x.providers, x.inputTokens, x.outputTokens, x.estCostUsd, x.rendersOk, x.rendersFailed, x.renderSec, x.variantsEdited, x.conceptsApproved, x.conceptsRejected, x.conceptsEdited, x.editChars, x.accepted, x.rejected, x.firstPassAccepted, x.exported]));
}

export function eventsCsv(events: readonly AnalyticsEvent[]): string {
  const keys = new Set<string>();
  for (const e of events) for (const k of Object.keys(e)) if (k !== "ts" && k !== "sid" && k !== "type") keys.add(k);
  const cols = [...keys].sort();
  return csv(["timestamp", "session_id", "event", ...cols], events.map((e) => [e.ts, e.sid, e.type, ...cols.map((c) => e[c] ?? null)]));
}

export const eventsInScope = (events: readonly AnalyticsEvent[], scope: Scope): AnalyticsEvent[] => {
  if (scope === "all") return [...events];
  const ids = new Set(replay(events).filter((s) => inScope(s, scope)).map((s) => s.sid));
  return events.filter((e) => ids.has(e.sid));
};
