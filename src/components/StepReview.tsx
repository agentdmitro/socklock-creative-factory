"use client";

import { useState } from "react";
import { Analytics01Icon, ArrowLeft01Icon, ArrowRight01Icon, CancelCircleIcon, CheckmarkCircle02Icon, Download04Icon, Film01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { fmtBytes, fmtDuration, outputUrl } from "@/lib/client";
import type { SessionSummary } from "@/lib/telemetry";
import { LIMITS, type Concept, type ConceptId, type RenderResult } from "@/lib/types";
import { Badge, type BadgeTone } from "./Badge";
import { Button, LinkButton } from "./Button";
import { TextArea } from "./Field";
import { Progress } from "./Progress";
import { VideoPreview } from "./VideoPreview";
import shared from "./steps.module.scss";
import styles from "./StepReview.module.scss";

export type Decision = "pending" | "accepted" | "rejected";

export type RenderState =
  | { status: "queued" }
  | { status: "rendering" }
  | { status: "done"; result: RenderResult; version: number; key: string; url?: string }
  | { status: "error"; message: string };

interface Props {
  jobId: string;
  sessionId: string;
  concepts: Concept[];
  renders: Partial<Record<ConceptId, RenderState>>;
  /** Fingerprint of each variant's CURRENT inputs; a rendered video whose key differs is outdated. */
  keys: Record<ConceptId, string>;
  decisions: Partial<Record<ConceptId, Decision>>;
  /** Optional "why rejected" notes, by concept. */
  reasons: Partial<Record<ConceptId, string>>;
  busy: boolean;
  summary: SessionSummary;
  conceptStats: { generated: number; approved: number; rejected: number };
  onExport: (id: ConceptId) => void;
  onReason: (id: ConceptId, text: string) => void;
  onDecide: (id: ConceptId, decision: "accepted" | "rejected") => void;
  onRetry: (id: ConceptId) => void;
  onUpdateOutdated: () => void;
  onEdit: () => void;
  onFinish: () => void;
  onInsights: () => void;
}

type View = { label: string; tone: BadgeTone };

function viewOf(r: RenderState | undefined, outdated: boolean, d: Decision): View {
  if (!r || r.status === "queued") return { label: "Waiting", tone: "neutral" };
  if (r.status === "rendering") return { label: "Rendering", tone: "neutral" };
  if (r.status === "error") return { label: "Failed", tone: "danger" };
  if (outdated) return { label: "Outdated", tone: "warn" };
  if (d === "accepted") return { label: "Accepted", tone: "ok" };
  if (d === "rejected") return { label: "Rejected", tone: "danger" };
  return { label: "To review", tone: "neutral" };
}

const mmss = (sec: number) => fmtDuration(sec);

export function StepReview(p: Props) {
  const order = p.concepts.filter((c) => p.renders[c.id]);
  const [selected, setSelected] = useState<ConceptId>(order[0]?.id ?? "c1");
  const [announce, setAnnounce] = useState("");
  const current = order.find((c) => c.id === selected) ?? order[0];

  const doneCount = order.filter((c) => p.renders[c.id]?.status === "done" || p.renders[c.id]?.status === "error").length;
  const outdated = (id: ConceptId) => {
    const r = p.renders[id];
    return r?.status === "done" && r.key !== p.keys[id];
  };
  const outdatedIds = order.filter((c) => outdated(c.id));
  const acceptedCount = order.filter((c) => p.decisions[c.id] === "accepted" && !outdated(c.id)).length;
  const decidedCount = order.filter((c) => (p.decisions[c.id] === "accepted" || p.decisions[c.id] === "rejected") && !outdated(c.id)).length;

  const decide = (id: ConceptId, d: "accepted" | "rejected") => {
    if (p.decisions[id] === d) return;
    p.onDecide(id, d);
    setAnnounce(`Variation ${order.findIndex((c) => c.id === id) + 1} ${d}.`);
  };

  /** Next rendered variation without a decision. Offered, never forced, so Download stays under the cursor. */
  const nextToReview = current
    ? [...order.slice(order.findIndex((c) => c.id === current.id) + 1), ...order.slice(0, order.findIndex((c) => c.id === current.id))].find((c) => {
        const r = p.renders[c.id];
        return r?.status === "done" && !outdated(c.id) && (!p.decisions[c.id] || p.decisions[c.id] === "pending");
      })
    : undefined;

  const r = current ? p.renders[current.id] : undefined;
  const isOutdated = current ? outdated(current.id) : false;
  const decision: Decision = current ? (p.decisions[current.id] ?? "pending") : "pending";
  const index = current ? order.findIndex((c) => c.id === current.id) : 0;

  return (
    <>
      <div>
        <h2 className={shared.cardTitle} tabIndex={-1} data-step-heading>Review and export</h2>
        <p className={shared.cardSub}>Watch each video, then accept the ones you would run. Only accepted videos can be exported and counted as finished work.</p>
      </div>

      {p.busy && <Progress value={order.length ? (doneCount / order.length) * 100 : 0} label={`Rendering ${Math.min(doneCount + 1, order.length)} of ${order.length}… a few seconds per video`} />}

      <div className={styles.picker} role="group" aria-label="Variations">
        {order.map((c, i) => {
          const view = viewOf(p.renders[c.id], outdated(c.id), p.decisions[c.id] ?? "pending");
          return (
            <button key={c.id} type="button" className={`${styles.pick} ${c.id === current?.id ? styles.pickActive : ""}`} aria-pressed={c.id === current?.id} onClick={() => setSelected(c.id)}>
              <span className={styles.pickName}>{i + 1}. {c.angle}</span>
              <Badge tone={view.tone}>{view.label}</Badge>
            </button>
          );
        })}
      </div>

      {current && (
        <section className={`${shared.card} ${styles.stage}`} aria-label={`Variation ${index + 1}: ${current.angle}`}>
          <div className={styles.media}>
            {r?.status === "done" ? (
              <VideoPreview key={`${current.id}-${r.version}`} src={r.url ?? outputUrl(p.jobId, r.result.file, r.version)} title={`Variation ${index + 1}, ${current.angle}`} />
            ) : r?.status === "error" ? (
              <div className={styles.placeholder} role="alert">
                <p className={styles.errorText}>{r.message}</p>
                <Button onClick={() => p.onRetry(current.id)} disabled={p.busy}>Retry this video</Button>
              </div>
            ) : (
              <div className={styles.placeholder}>
                <Progress label={r?.status === "rendering" ? "Rendering…" : "Waiting…"} />
              </div>
            )}
          </div>

          <div className={styles.side}>
            <div>
              <h3 className={styles.name}>{index + 1}. {current.angle}</h3>
              {current.rationale && <p className={styles.why}>{current.rationale}</p>}
            </div>
            <dl className={styles.copy}>
              <div><dt>Hook</dt><dd>{current.hook}</dd></div>
              <div><dt>Opening line</dt><dd>{current.openingLine}</dd></div>
              <div><dt>On-screen text</dt><dd>{current.onScreenText}</dd></div>
              <div><dt>Call to action</dt><dd>{current.cta}</dd></div>
            </dl>
            {r?.status === "done" && (
              <p className={styles.facts}>
                {r.result.width}×{r.result.height} · H.264 · {r.result.durationSec} s · {fmtBytes(r.result.sizeBytes)} · rendered in {(r.result.renderMs / 1000).toFixed(1)} s
              </p>
            )}

            {isOutdated && (
              <div className={shared.notice} role="status">
                The copy or segment changed after this video was rendered, so the earlier decision was cleared.
                <div className={styles.inline}><Button icon={Film01Icon} onClick={p.onUpdateOutdated} disabled={p.busy}>Re-render {outdatedIds.length > 1 ? `${outdatedIds.length} outdated videos` : "this video"}</Button></div>
              </div>
            )}

            <div className={styles.decide} role="group" aria-label="Decision">
              <Button variant={decision === "accepted" ? "primary" : "secondary"} icon={decision === "accepted" ? Tick02Icon : CheckmarkCircle02Icon} aria-pressed={decision === "accepted"} disabled={r?.status !== "done" || isOutdated || p.busy} onClick={() => decide(current.id, "accepted")}>
                {decision === "accepted" ? "Accepted" : "Accept"}
              </Button>
              <Button variant="secondary" icon={CancelCircleIcon} aria-pressed={decision === "rejected"} disabled={r?.status !== "done" || isOutdated || p.busy} onClick={() => decide(current.id, "rejected")}>
                {decision === "rejected" ? "Rejected" : "Reject"}
              </Button>
              {r?.status === "done" && decision === "accepted" && !isOutdated ? (
                <LinkButton icon={Download04Icon} download={r.result.file} onClick={() => r.url && p.onExport(current.id)} href={r.url ?? outputUrl(p.jobId, r.result.file, r.version, { sessionId: p.sessionId })}>Download MP4</LinkButton>
              ) : (
                <Button icon={Download04Icon} disabled title="Accept this video to enable the download">Download MP4</Button>
              )}
            </div>
            {decision !== "pending" && !isOutdated && nextToReview && (
              <div>
                <Button variant="secondary" iconEnd={ArrowRight01Icon} onClick={() => setSelected(nextToReview.id)}>Next to review: {nextToReview.angle}</Button>
              </div>
            )}
            {decision === "rejected" && !isOutdated && (
              <TextArea label="Why was it rejected? (optional)" rows={2} maxLength={LIMITS.maxReasonChars}
                value={p.reasons[current.id] ?? ""} onChange={(e) => p.onReason(current.id, e.target.value)}
                counter={{ value: (p.reasons[current.id] ?? "").length, max: LIMITS.maxReasonChars }}
                hint="Shown on the summary page. It stays in this tab and is not sent anywhere." placeholder="e.g. hook too generic, wrong tone…" />
            )}
            {decision === "rejected" && !isOutdated && (
              <p className={styles.hint}>Not what you wanted? <button type="button" className={styles.textLink} onClick={p.onEdit} disabled={p.busy}>Edit the concept</button> and re-render just this video.</p>
            )}
          </div>
        </section>
      )}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>

      <section className={shared.card} aria-labelledby="session-title">
        <div>
          <h2 id="session-title" className={shared.cardTitle}>This session</h2>
          <p className={shared.cardSub}>Measured from your actual activity. Idea work, video work and machine waiting time are counted separately.</p>
        </div>
        <dl className={styles.stats}>
          <Stat label="Concepts approved" value={`${p.conceptStats.approved} of ${p.conceptStats.generated}`} note={`${p.conceptStats.rejected} rejected · ${acceptedCount} of ${order.length} videos accepted`} />
          <Stat label="Time on ideas" value={mmss(p.summary.ideationSec)} note={p.conceptStats.approved ? `${mmss(Math.round(p.summary.ideationSec / p.conceptStats.approved))} per approved concept` : "no approved concept yet"} />
          <Stat label="Time on video" value={mmss(Math.max(0, p.summary.activeSec - p.summary.ideationSec))} note={acceptedCount ? `${mmss(Math.round(Math.max(0, p.summary.activeSec - p.summary.ideationSec) / acceptedCount))} per accepted video` : "no accepted video yet"} />
          <Stat label="Waiting" value={mmss(p.summary.waitSec)} note="upload, AI, rendering (not hands-on)" />
          <Stat label="Editing effort" value={`${p.summary.charsChanged}`} note={`characters changed in brief and concepts · ${p.summary.segmentEdits} segment tweaks`} />
        </dl>
        <div className={shared.chips}>
          <Button variant="ghost" icon={Analytics01Icon} onClick={p.onInsights}>Open Insights</Button>
        </div>
      </section>

      <div className={shared.footer}>
        <Button variant="ghost" icon={ArrowLeft01Icon} onClick={p.onEdit} disabled={p.busy}>Edit concepts</Button>
        <Button variant="primary" icon={Tick02Icon} onClick={p.onFinish} disabled={p.busy || decidedCount === 0} title={decidedCount === 0 ? "Accept or reject at least one video first" : undefined}>
          Finish session
        </Button>
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd className={styles.statValue}>{value}</dd>
      <dd className={styles.statNote}>{note}</dd>
    </div>
  );
}
