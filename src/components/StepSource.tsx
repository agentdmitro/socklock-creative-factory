"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { fmtBytes, fmtTime, sourceUrl } from "@/lib/client";
import { CONCEPT_COUNTS, LIMITS, type AiStatus, type FitMode, type ProviderId, type SourceInfo } from "@/lib/types";
import { ArrowRight01Icon, PlayIcon, Upload04Icon } from "@hugeicons/core-free-icons";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Select } from "./Select";
import { TextArea, TextInput } from "./Field";
import { Progress } from "./Progress";
import aiStyles from "./AiBadge.module.scss";
import shared from "./steps.module.scss";
import styles from "./StepSource.module.scss";

export interface SourceFields {
  script: string;
  product: string;
  cta: string;
}

interface Props {
  fields: SourceFields;
  count: number;
  loading: boolean;
  /** True when the concepts on screen already match this brief, so continuing costs nothing. */
  unchanged: boolean;
  ai: AiStatus | null;
  provider: ProviderId;
  onProvider: (p: ProviderId) => void;
  onCount: (n: number) => void;
  onFields: (next: SourceFields, charDelta: number) => void;
  onContinue: () => void;
  source: SourceInfo | null;
  upload: { active: boolean; pct: number };
  range: { start: number; end: number };
  fit: FitMode;
  blocked: boolean;
  onFile: (f: File) => void;
  onRange: (r: { start: number; end: number }) => void;
  onFit: (f: FitMode) => void;
}

const STEP = 0.1;
const round = (n: number) => Math.round(n * 10) / 10;

export function StepSource(p: Props) {
  const { source, range, fields } = p;
  const [showErrors, setShowErrors] = useState(false);
  const errors = {
    script: fields.script.trim() ? "" : "Paste the original script so the concepts stay relevant.",
    product: fields.product.trim() ? "" : "Describe the product, e.g. “SockLock — anti-slip sports socks”.",
    cta: fields.cta.trim() ? "" : "Add a short call to action.",
  };
  const valid = !errors.script && !errors.product && !errors.cta;
  const setField = (key: keyof SourceFields, value: string) =>
    p.onFields({ ...fields, [key]: value }, Math.max(1, Math.abs(value.length - fields[key].length)));
  const [dragging, setDragging] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const playingRange = useRef(false);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      if (playingRange.current && v.currentTime >= range.end) {
        v.pause();
        playingRange.current = false;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [range.end]);

  const seek = (t: number) => {
    const v = video.current;
    if (v) v.currentTime = t;
  };

  const move = (which: "start" | "end", raw: number) => {
    if (!source) return;
    const dur = source.durationSec;
    let { start, end } = range;
    const value = round(raw);
    if (which === "start") {
      start = Math.min(value, dur - LIMITS.minSegmentSec);
      end = Math.max(end, start + LIMITS.minSegmentSec);
      end = Math.min(end, start + LIMITS.maxSegmentSec, dur);
    } else {
      end = Math.max(value, LIMITS.minSegmentSec);
      start = Math.min(start, end - LIMITS.minSegmentSec);
      start = Math.max(start, end - LIMITS.maxSegmentSec, 0);
    }
    p.onRange({ start: round(start), end: round(end) });
    seek(which === "start" ? start : end);
  };

  const playRange = () => {
    const v = video.current;
    if (!v) return;
    v.currentTime = range.start;
    playingRange.current = true;
    void v.play();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) p.onFile(f);
  };

  const len = range.end - range.start;
  const speed = 6 / len;

  return (
    <>
      <section className={shared.card} aria-labelledby="src-title">
        <div>
          <h2 id="src-title" className={shared.cardTitle} tabIndex={-1} data-step-heading>Source video</h2>
          <p className={shared.cardSub}>One MP4 with the product in use, up to {LIMITS.maxUploadBytes / 1024 / 1024} MB. It never leaves this computer.</p>
        </div>

        {!source && !p.upload.active && (
          <label
            className={`${styles.drop} ${dragging ? styles.dragging : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              className={styles.file}
              type="file"
              accept="video/mp4,.mp4"
              disabled={p.blocked}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) p.onFile(f);
                e.target.value = "";
              }}
            />
            <span className={styles.dropIcon}><Icon icon={Upload04Icon} size={26} /></span>
            <span className={styles.dropTitle}>Choose an MP4 or drop it here</span>
            <span className={styles.dropHint}>{p.blocked ? "Install FFmpeg first (see the notice above)." : "H.264 works best. Landscape or portrait."}</span>
          </label>
        )}

        {p.upload.active && <Progress value={p.upload.pct} label={p.upload.pct >= 99 ? "Inspecting video…" : `Uploading… ${Math.round(p.upload.pct)}%`} />}

        {source && (
          <div className={styles.preview}>
            <video ref={video} className={styles.video} src={sourceUrl(source.jobId)} controls preload="metadata" playsInline muted />
            <div className={shared.chips}>
              <span className={shared.chip}>{source.fileName}</span>
              <span className={shared.chip}>{fmtTime(source.durationSec)}</span>
              <span className={shared.chip}>{source.width}×{source.height}</span>
              {source.fps > 0 && <span className={shared.chip}>{source.fps} fps</span>}
              <span className={shared.chip}>{fmtBytes(source.sizeBytes)}</span>
              {source.hasAudio && <span className={shared.chip}>Audio will be muted</span>}
            </div>
            {source.warnings.map((w) => <p key={w} className={shared.notice}>{w}</p>)}
            <label className={styles.replace}>
              <input className={styles.file} type="file" accept="video/mp4,.mp4" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onFile(f); e.target.value = ""; }} />
              Replace video
            </label>
          </div>
        )}
      </section>

      <section className={shared.card} aria-labelledby="ctx-title">
        <div>
          <h2 id="ctx-title" className={shared.cardTitle}>Script and product</h2>
          <p className={shared.cardSub}>Used to write the concepts. The original voice-over is never reused.</p>
        </div>
        <TextArea label="Original script" value={fields.script} onChange={(e) => setField("script", e.target.value)} rows={4}
          counter={{ value: fields.script.length, max: LIMITS.maxScriptChars }} maxLength={LIMITS.maxScriptChars + 200}
          error={showErrors ? errors.script : ""} placeholder="Paste what is said or shown in the source video…" />
        <div className={shared.grid2}>
          <TextArea label="Product context" value={fields.product} onChange={(e) => setField("product", e.target.value)} rows={3}
            counter={{ value: fields.product.length, max: LIMITS.maxProductChars }} maxLength={LIMITS.maxProductChars + 50}
            error={showErrors ? errors.product : ""} hint="Start with the product name." placeholder="SockLock — anti-slip sports socks that stay put" />
          <TextInput label="Call to action" value={fields.cta} onChange={(e) => setField("cta", e.target.value)}
            counter={{ value: fields.cta.length, max: LIMITS.maxCtaChars }} maxLength={LIMITS.maxCtaChars + 10}
            error={showErrors ? errors.cta : ""} placeholder="Shop now" />
        </div>
        <div className={styles.countRow}>
          <Select
            label="How many concepts"
            showLabel
            value={String(p.count)}
            onChange={(v) => p.onCount(Number(v))}
            disabled={p.loading}
            options={CONCEPT_COUNTS.map((n) => ({ value: String(n), label: `${n} concepts`, hint: n === 6 ? "Default" : n === 3 ? "Quick scan" : "Widest range" }))}
          />
          <p className={shared.cardSub}>Each concept uses a different angle, not a rewording of another.</p>
        </div>
      </section>

      {source && (
        <section className={shared.card} aria-labelledby="seg-title">
          <div>
            <h2 id="seg-title" className={shared.cardTitle}>Demonstration segment</h2>
            <p className={shared.cardSub}>Pick {LIMITS.minSegmentSec}–{LIMITS.maxSegmentSec} seconds where the product is clearly shown. It is fitted into the 6-second demo.</p>
          </div>
          <div className={styles.sliders}>
            <label className={styles.slider}>
              <span>Start <b>{fmtTime(range.start)}.{Math.round((range.start % 1) * 10)}</b></span>
              <input type="range" min={0} max={Math.max(0, source.durationSec - LIMITS.minSegmentSec)} step={STEP} value={range.start} onChange={(e) => move("start", Number(e.target.value))} />
            </label>
            <label className={styles.slider}>
              <span>End <b>{fmtTime(range.end)}.{Math.round((range.end % 1) * 10)}</b></span>
              <input type="range" min={LIMITS.minSegmentSec} max={source.durationSec} step={STEP} value={range.end} onChange={(e) => move("end", Number(e.target.value))} />
            </label>
          </div>
          <div className={styles.segmentMeta}>
            <span>{len.toFixed(1)}s selected · plays at {speed.toFixed(2)}×{speed < 0.99 ? " (slow motion)" : speed > 1.01 ? " (sped up)" : ""}</span>
            <Button variant="ghost" icon={PlayIcon} onClick={playRange}>Preview selection</Button>
          </div>

          <fieldset className={styles.fit}>
            <legend>Framing</legend>
            {(["contain", "cover"] as const).map((f) => (
              <label key={f} className={`${styles.option} ${p.fit === f ? styles.selected : ""}`}>
                <input type="radio" name="fit" value={f} checked={p.fit === f} onChange={() => p.onFit(f)} />
                <span className={styles.optionTitle}>{f === "contain" ? "Fit (recommended)" : "Fill"}</span>
                <span className={styles.optionHint}>{f === "contain" ? "Whole frame visible, with margins." : "Crops edges to fill the area."}</span>
              </label>
            ))}
          </fieldset>
        </section>
      )}

      <div className={shared.footer}>
        {p.ai?.gemini.configured ? (
          <div className={aiStyles.toggle}>
            <Select
              label="Idea provider"
              showLabel
              value={p.provider}
              onChange={p.onProvider}
              disabled={p.loading}
              options={[
                { value: "mock", label: "Mock (offline, free)", hint: "Deterministic ideas, no AI call" },
                { value: "gemini", label: `Gemini (${p.ai.gemini.model})`, hint: "Script and product text are sent to Google" },
              ]}
            />
          </div>
        ) : (
          <span />
        )}
        <div className={shared.footerEnd}>
          {showErrors && !valid && <p className={styles.footerHint} role="status">Complete the highlighted fields.</p>}
          <Button variant="primary" iconEnd={ArrowRight01Icon} loading={p.loading} onClick={() => (valid ? p.onContinue() : setShowErrors(true))}>
            {p.unchanged ? "Back to concepts" : `Create ${p.count} concepts`}
          </Button>
        </div>
      </div>
    </>
  );
}
