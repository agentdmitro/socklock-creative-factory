"use client";

import { Analytics01Icon, CancelCircleIcon, CheckmarkCircle02Icon, Download04Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { fmtBytes, fmtDuration, outputUrl } from "@/lib/client";
import type { SessionSummary } from "@/lib/telemetry";
import type { Concept, RenderResult } from "@/lib/types";
import { Badge } from "./Badge";
import { Button, LinkButton } from "./Button";
import { Icon } from "./Icon";
import { VideoPreview } from "./VideoPreview";
import shared from "./steps.module.scss";
import styles from "./StepDone.module.scss";

export interface DoneItem {
  concept: Concept;
  result: RenderResult;
  version: number;
  decision: "accepted" | "rejected";
  /** Optional note the reviewer wrote when rejecting. Kept in this browser tab only, never sent anywhere. */
  reason: string;
}

export interface DoneState {
  jobId: string;
  sessionId: string;
  items: DoneItem[];
  summary: SessionSummary;
  conceptStats: { generated: number; approved: number; rejected: number };
}

interface Props {
  done: DoneState;
  onNew: () => void;
  onInsights: () => void;
}

/** Shown after "Finish session": the approved videos ready to download, and what was rejected and why. */
export function StepDone({ done, onNew, onInsights }: Props) {
  const accepted = done.items.filter((i) => i.decision === "accepted");
  const rejected = done.items.filter((i) => i.decision === "rejected");
  const { summary: s, conceptStats: c } = done;

  return (
    <>
      <section className={`${shared.card} ${styles.hero}`}>
        <span className={styles.heroIcon}><Icon icon={CheckmarkCircle02Icon} size={28} /></span>
        <div>
          <h2 className={shared.cardTitle} tabIndex={-1} data-step-heading>Session complete</h2>
          <p className={shared.cardSub}>
            {accepted.length ? `${accepted.length} video${accepted.length > 1 ? "s are" : " is"} approved and ready to download.` : "No video was approved this time."}
          </p>
          <div className={shared.chips}>
            <span className={shared.chip}>{accepted.length} approved</span>
            <span className={shared.chip}>{rejected.length} rejected</span>
            <span className={shared.chip}>{c.approved} of {c.generated} concepts approved</span>
            <span className={shared.chip}>{fmtDuration(s.ideationSec)} on ideas</span>
            <span className={shared.chip}>{fmtDuration(Math.max(0, s.activeSec - s.ideationSec))} on video</span>
          </div>
        </div>
      </section>

      {accepted.length > 0 && (
        <section aria-labelledby="done-ok">
          <h3 id="done-ok" className={styles.h3}>Approved videos</h3>
          <div className={styles.grid}>
            {accepted.map((i) => (
              <article key={i.concept.id} className={`${shared.card} ${styles.item}`} aria-label={`${i.concept.angle}, approved`}>
                <VideoPreview src={outputUrl(done.jobId, i.result.file, i.version)} title={`${i.concept.angle}, approved`} />
                <div className={styles.meta}>
                  <div className={styles.titleRow}>
                    <h4 className={styles.name}>{i.concept.angle}</h4>
                    <Badge tone="ok">Approved</Badge>
                  </div>
                  <p className={styles.hook}>{i.concept.hook}</p>
                  <p className={styles.small}>{i.concept.onScreenText} · {i.concept.cta}</p>
                  <p className={styles.small}>{i.result.width}×{i.result.height} · {fmtBytes(i.result.sizeBytes)}</p>
                </div>
                <LinkButton icon={Download04Icon} download href={outputUrl(done.jobId, i.result.file, i.version, { sessionId: done.sessionId })}>Download MP4</LinkButton>
              </article>
            ))}
          </div>
        </section>
      )}

      {rejected.length > 0 && (
        <section aria-labelledby="done-no">
          <h3 id="done-no" className={styles.h3}>Rejected</h3>
          <div className={styles.rejectedList}>
            {rejected.map((i) => (
              <article key={i.concept.id} className={`${shared.card} ${styles.rejected}`} aria-label={`${i.concept.angle}, rejected`}>
                <div className={styles.titleRow}>
                  <h4 className={styles.name}><Icon icon={CancelCircleIcon} size={16} /> {i.concept.angle}</h4>
                  <Badge tone="danger">Rejected</Badge>
                </div>
                <p className={styles.hook}>{i.concept.hook}</p>
                <p className={i.reason ? styles.reason : styles.small}>{i.reason ? `Reason: ${i.reason}` : "No reason given."}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className={shared.footer}>
        <Button variant="ghost" icon={Analytics01Icon} onClick={onInsights}>Open Insights</Button>
        <Button variant="primary" icon={RefreshIcon} onClick={onNew}>Start a new session</Button>
      </div>
    </>
  );
}
