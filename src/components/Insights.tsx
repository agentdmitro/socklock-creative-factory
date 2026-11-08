"use client";

import { useEffect, useState } from "react";
import type { IconSvgElement } from "@hugeicons/react";
import { AiMagicIcon, Analytics01Icon, Calculator01Icon, CancelCircleIcon, CheckmarkCircle02Icon, Clock01Icon, Csv01Icon, Database01Icon, Download04Icon, Edit02Icon, Film01Icon, HourglassIcon, MagicWand01Icon, Refresh01Icon, Target02Icon, Timer02Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import { SCOPES, type InsightsReport, type Scope } from "@/lib/analytics";
import { fmtDuration, getInsights, insightsCsvUrl } from "@/lib/client";
import { Badge } from "./Badge";
import { Button, LinkButton } from "./Button";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { fmtUsd } from "./AiBadge";
import { Progress } from "./Progress";
import { ScenarioCalculator } from "./ScenarioCalculator";
import { Tabs } from "./Tabs";
import shared from "./steps.module.scss";
import styles from "./Insights.module.scss";

const SCOPE_LABEL: Record<Scope, string> = { interactive: "Hands-on sessions", scripted: "Scripted demo runs", all: "All data" };
const SCOPE_HINT: Record<Scope, string> = { interactive: "Real work in the app (default)", scripted: "Automated pipeline checks", all: "Both, mixed" };
type TabId = "measured" | "scenarios";

/** Business targets from the brief. Goals, not results. */
export const BASELINE_MIN = 180;
const TARGET_MIN = 86;
const STRETCH_MIN = 58;

const int = new Intl.NumberFormat("en");
const pct = (n: number) => `${Math.round(n * 100)}%`;
const fmtMin = (m: number) => (m < 1 ? `${Math.round(m * 60)} s` : `${m.toFixed(1)} min`);
const reduction = (min: number) => `${Math.round((1 - min / BASELINE_MIN) * 100)}%`;

export function Insights() {
  const [scope, setScope] = useState<Scope>("interactive");
  const [tab, setTab] = useState<TabId>("measured");
  const [result, setResult] = useState<{ key: string; report: InsightsReport | null; error: string }>({ key: "", report: null, error: "" });
  const [other, setOther] = useState<InsightsReport | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${scope}:${nonce}`;

  useEffect(() => {
    let live = true;
    getInsights(scope)
      .then((report) => live && setResult({ key, report, error: "" }))
      .catch((e: unknown) => live && setResult({ key, report: null, error: e instanceof Error ? e.message : "Could not load insights." }));
    return () => {
      live = false;
    };
  }, [scope, key]);

  // The scenario calculator may offer MEASURED values, but only ever from real hands-on sessions.
  useEffect(() => {
    if (scope === "interactive") return;
    let live = true;
    getInsights("interactive").then((r) => live && setOther(r)).catch(() => live && setOther(null));
    return () => {
      live = false;
    };
  }, [scope, nonce]);

  const loading = result.key !== key;
  const report = result.report?.scope === scope ? result.report : null; // never show another scope's numbers
  const error = result.key === key ? result.error : "";
  const interactive = scope === "interactive" ? report : other;

  return (
    <>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.titleIcon}><Icon icon={Analytics01Icon} size={22} /></span>
          <div>
            <h2 className={styles.title} tabIndex={-1} data-step-heading>Insights</h2>
            <p className={shared.cardSub}>Measured on this computer from your own sessions. Nothing is sent anywhere.</p>
          </div>
        </div>
        <Select
          label="Data shown"
          showLabel
          value={scope}
          onChange={setScope}
          options={SCOPES.map((v) => ({ value: v, label: SCOPE_LABEL[v], hint: SCOPE_HINT[v] }))}
        />
      </div>

      <Tabs<TabId> label="Insights sections" value={tab} onChange={setTab} tabs={[{ id: "measured", label: "Measured", icon: Analytics01Icon }, { id: "scenarios", label: "Business scenarios", icon: Calculator01Icon }]}>
        {tab === "measured" ? (
          <Measured report={report} scope={scope} loading={loading} error={error} onRetry={() => setNonce((n) => n + 1)} />
        ) : (
          <ScenarioCalculator measured={interactive} />
        )}
      </Tabs>
    </>
  );
}

function Measured({ report, scope, loading, error, onRetry }: { report: InsightsReport | null; scope: Scope; loading: boolean; error: string; onRetry: () => void }) {
  if (error) {
    return (
      <div className={shared.notice} role="alert">
        {error} <Button variant="secondary" icon={Refresh01Icon} onClick={onRetry}>Try again</Button>
      </div>
    );
  }
  if (!report) return <Progress label="Loading measurements…" />;
  const empty = report.funnel.sources === 0 && report.sessions.started === 0;
  const h = report.humanTime;
  const r = report.rendering;
  const a = report.acceptance;
  const ai = report.ai;
  const idea = report.ideation;
  const measured = h.minutesPerAccepted;

  return (
    <>
      {scope !== "interactive" && (
        <p className={shared.notice} role="status">
          {scope === "scripted" ? "Scripted runs are automated pipeline checks. " : "This includes scripted runs. "}
          They prove the tooling works, but no person was timed, so they are excluded from human time per accepted variation.
        </p>
      )}
      {empty ? (
        <section className={`${shared.card} ${styles.empty}`}>
          <span className={styles.emptyIcon}><Icon icon={Database01Icon} size={28} /></span>
          <h3 className={shared.cardTitle}>No measurements yet</h3>
          <p className={shared.cardSub}>
            {scope === "scripted"
              ? "Run `npm run demo` to record a scripted pipeline run."
              : "Write a brief, create concepts, approve the ones you like, then render and accept videos. Numbers appear here once a session has real activity."}
          </p>
        </section>
      ) : (
        <>
          <div className={styles.meta}>
            <Badge tone="ok">Measured</Badge>
            <span>
              {int.format(report.sessions.started)} session{report.sessions.started === 1 ? "" : "s"} ({report.sessions.completed} finished, {report.sessions.timed} timed)
              {loading && " · refreshing…"}
            </span>
          </div>

          <dl className={styles.tiles}>
            <Tile icon={CheckmarkCircle02Icon} tone="ok" label="Accepted variations" value={int.format(a.accepted)} note={`${int.format(report.funnel.rendered)} rendered · ${int.format(a.rejected)} rejected · ${int.format(a.undecided)} undecided`} help="Only videos you explicitly accepted. Generating or rendering does not count." />
            <Tile icon={Clock01Icon} tone="accent" label="Human time per accepted" value={measured === null ? "—" : fmtMin(measured)} note={measured === null ? (h.timedSessions ? "no accepted video in timed sessions yet" : "no timed session yet") : `${fmtDuration(h.activeSec)} hands-on over ${h.timedSessions} session${h.timedSessions === 1 ? "" : "s"}`} help="Hands-on time (gaps over 15 s are idle) divided by accepted variations, including time spent on rejected ones." />
            <Tile icon={Target02Icon} tone="accent" label="First-pass acceptance" value={a.firstPassRate === null ? "—" : pct(a.firstPassRate)} note={a.decided ? `${a.firstPassAccepted} of ${a.decided} decided accepted on the first render` : "no decisions yet"} help="Accepted without needing a re-render. Rejected videos count against it." />
            <Tile icon={Timer02Icon} tone="neutral" label="Rendering" value={r.avgSec === null ? "—" : `${r.avgSec.toFixed(1)} s`} note={r.attempts ? `avg per video · max ${r.maxSec?.toFixed(1)} s · ${r.failed} of ${r.attempts} renders failed${r.failureRate !== null ? ` (${pct(r.failureRate)})` : ""}` : "no renders yet"} help="Server-measured duration of each successful render. Waiting time is not hands-on time." />
            <Tile icon={AiMagicIcon} tone="forecast" label="AI/API cost (estimate)" value={ai.requests ? fmtUsd(ai.estCostUsd) : "—"} note={ai.costPerAcceptedUsd === null ? `${ai.byProvider.gemini} Gemini · ${ai.byProvider.mock} Mock request${ai.byProvider.mock === 1 ? "" : "s"}` : `${fmtUsd(ai.costPerAcceptedUsd)} per accepted · ${ai.byProvider.gemini} Gemini · ${ai.byProvider.mock} Mock`} help="Estimated from list prices and reported tokens. Mock mode costs nothing. This is not the billed amount." />
            <Tile icon={HourglassIcon} tone="neutral" label="Hands-on vs waiting" value={fmtDuration(h.activeSec)} note={`${fmtDuration(h.waitSec)} waiting on upload, AI and rendering`} help="The two are tracked separately so machine time never inflates human effort." />
          </dl>

          <section className={shared.card} aria-labelledby="ideas-title">
            <div>
              <h3 id="ideas-title" className={styles.h3}><Icon icon={MagicWand01Icon} size={18} />Ideas, measured apart from video</h3>
              <p className={shared.cardSub}>Switching a concept on for video is a decision about the idea. Accepting a video (above) is a separate decision about the render.</p>
            </div>
            <dl className={styles.tiles}>
              <Tile icon={CheckmarkCircle02Icon} tone="ok" label="Approved concepts" value={int.format(idea.approved)} note={idea.generated ? `of ${int.format(idea.generated)} generated · ${int.format(idea.rejected)} rejected${idea.approvalRate !== null ? ` · ${pct(idea.approvalRate)} kept` : ""}` : "no concepts yet"} help="Concepts switched on for video. The first three start on; the rest count as rejected until you switch them on. This is about the idea, not the finished video." />
              <Tile icon={Edit02Icon} tone="accent" label="Editing effort" value={idea.editCharsPerApproved === null ? "—" : `${idea.editCharsPerApproved} chars`} note={idea.approved ? `per approved concept · ${idea.approvedUnedited} of ${idea.approved} approved as generated · ${idea.edited} edited` : "no approved concept yet"} help="Characters actually changed in concept copy (insertions and deletions after trimming what stayed the same), divided by approved concepts." />
              <Tile icon={Clock01Icon} tone="accent" label="Time on ideas" value={idea.minutesPerApproved === null ? "—" : fmtMin(idea.minutesPerApproved)} note={idea.sessions ? `per approved concept · ${fmtDuration(idea.activeSec)} hands-on over ${idea.sessions} session${idea.sessions === 1 ? "" : "s"}` : "no timed session with the idea/video split yet"} help="Hands-on time on the brief and concept review, divided by approved concepts. Waiting for the AI is not included." />
              <Tile icon={Film01Icon} tone="neutral" label="Time on video" value={idea.sessions ? fmtDuration(idea.videoReviewSec) : "—"} note={idea.sessions ? `hands-on setup and review · ${fmtDuration(idea.renderWaitSec)} machine time rendering` : "no timed session yet"} help="Hands-on time choosing the segment and reviewing rendered videos. Rendering itself is machine time and is shown separately." />
              <Tile icon={AiMagicIcon} tone="forecast" label="Cost per approved concept" value={idea.costPerApprovedUsd === null ? "—" : fmtUsd(idea.costPerApprovedUsd)} note={ai.costPerAcceptedUsd === null ? "estimate · no accepted video yet" : `estimate · ${fmtUsd(ai.costPerAcceptedUsd)} per accepted video`} help="Estimated AI cost divided by approved concepts. Mock mode costs nothing. Not the billed amount." />
              <Tile icon={HourglassIcon} tone="neutral" label="AI waiting" value={fmtDuration(idea.aiWaitSec)} note="machine time creating concepts" help="Tracked apart from hands-on time so waiting never inflates human effort." />
            </dl>
          </section>

          <section className={shared.card} aria-labelledby="targets-title">
            <div>
              <h3 id="targets-title" className={styles.h3}><Icon icon={Target02Icon} size={18} />Against the business targets</h3>
              <p className={shared.cardSub}>Targets are goals, not results. The 180-minute baseline is a reference figure, not something this tool measured.</p>
            </div>
            <table className={styles.table}>
              <thead>
                <tr><th scope="col">Minutes per accepted variation</th><th scope="col" className={styles.num}>Minutes</th><th scope="col" className={styles.num}>Reduction</th><th scope="col" className={styles.barCol}><span className="sr-only">Bar</span></th></tr>
              </thead>
              <tbody>
                <tr><th scope="row">Baseline (reference, not verified)</th><td className={styles.num}>{BASELINE_MIN}</td><td className={styles.num}>—</td><td className={styles.barCol}><Bar min={BASELINE_MIN} tone="neutral" /></td></tr>
                <tr><th scope="row">Initial target</th><td className={styles.num}>≤ {TARGET_MIN}</td><td className={styles.num}>≈ {reduction(TARGET_MIN)}</td><td className={styles.barCol}><Bar min={TARGET_MIN} tone="target" /></td></tr>
                <tr><th scope="row">Stretch target</th><td className={styles.num}>≤ {STRETCH_MIN}</td><td className={styles.num}>≈ {reduction(STRETCH_MIN)}</td><td className={styles.barCol}><Bar min={STRETCH_MIN} tone="target" /></td></tr>
                <tr className={styles.measuredRow}>
                  <th scope="row">Measured here</th>
                  <td className={styles.num}>{measured === null ? "—" : fmtMin(measured)}</td>
                  <td className={styles.num}>{measured === null ? "—" : reduction(measured)}</td>
                  <td className={styles.barCol}>{measured !== null && <Bar min={measured} tone="measured" />}</td>
                </tr>
              </tbody>
            </table>
            <p className={styles.caveat}>
              The measured figure covers in-tool hands-on time only (editing, previewing, deciding). It excludes briefing, stakeholder review and anything done outside this tool,
              and it comes from {h.timedSessions} session{h.timedSessions === 1 ? "" : "s"} by a single user, so it is indicative, not a verified like-for-like comparison.
            </p>
          </section>

          <section className={shared.card} aria-labelledby="activity-title">
            <h3 id="activity-title" className={styles.h3}><Icon icon={Analytics01Icon} size={18} />Activity</h3>
            <dl className={styles.list}>
              <Row icon={Upload04Icon} k="Sources uploaded" v={report.funnel.sources} />
              <Row icon={MagicWand01Icon} k="Concepts generated" v={report.funnel.variationsGenerated} />
              <Row icon={CheckmarkCircle02Icon} k="Concepts approved" v={idea.approved} note={`${idea.rejected} rejected`} />
              <Row icon={Edit02Icon} k="Concepts edited" v={idea.edited} />
              <Row icon={Film01Icon} k="Variants rendered" v={report.funnel.rendered} note={`${r.attempts} render attempts`} />
              <Row icon={CheckmarkCircle02Icon} k="Accepted" v={a.accepted} />
              <Row icon={CancelCircleIcon} k="Rejected" v={a.rejected} />
              <Row icon={Download04Icon} k="Exported (downloads served)" v={report.funnel.exported} />
              <Row icon={AiMagicIcon} k="AI requests" v={ai.requests} note={`${ai.cached} reused from cache · ${ai.fallbacks} fell back to Mock`} />
              <Row icon={Database01Icon} k="Tokens in / out" v={`${int.format(ai.tokens.input)} / ${int.format(ai.tokens.output + ai.tokens.thought)}`} />
            </dl>
          </section>

          <div className={styles.export}>
            <LinkButton icon={Csv01Icon} download href={insightsCsvUrl("sessions", scope)}>Download sessions CSV</LinkButton>
            <LinkButton icon={Download04Icon} download href={insightsCsvUrl("events", scope)}>Download events CSV</LinkButton>
            <Button variant="ghost" icon={Refresh01Icon} onClick={onRetry} loading={loading}>Refresh</Button>
          </div>
        </>
      )}
    </>
  );
}

function Tile({ label, value, note, help, icon, tone }: { label: string; value: string; note: string; help: string; icon: IconSvgElement; tone: "ok" | "accent" | "neutral" | "forecast" }) {
  return (
    <div className={styles.tile} title={help}>
      <dt>
        <span className={`${styles.chip} ${styles[tone]}`}><Icon icon={icon} size={17} /></span>
        {label}
      </dt>
      <dd className={styles.value}>{value}</dd>
      <dd className={styles.note}>{note}</dd>
    </div>
  );
}

function Row({ k, v, note, icon }: { k: string; v: number | string; note?: string; icon: IconSvgElement }) {
  return (
    <div className={styles.row}>
      <dt><Icon icon={icon} size={16} className={styles.rowIcon} />{k}</dt>
      <dd>
        <b>{typeof v === "number" ? int.format(v) : v}</b>
        {note && <span> · {note}</span>}
      </dd>
    </div>
  );
}

/** Visual length of a minutes value against the 180-minute baseline. Decorative: the numbers are in the table. */
function Bar({ min, tone }: { min: number; tone: "neutral" | "target" | "measured" }) {
  return (
    <span className={styles.track} aria-hidden="true">
      <span className={`${styles.fill} ${styles[`bar_${tone}`]}`} style={{ width: `${Math.max(1, Math.min(100, (min / BASELINE_MIN) * 100))}%` }} />
    </span>
  );
}
