"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { OUTPUT } from "@/lib/types";
import { fmtTime } from "@/lib/client";
import styles from "./VideoPreview.module.scss";

const SEGMENTS = [
  { id: "hook", label: "Hook", start: 0, end: OUTPUT.hookSec },
  { id: "demo", label: "Demo", start: OUTPUT.hookSec, end: OUTPUT.hookSec + OUTPUT.demoSec },
  { id: "cta", label: "CTA", start: OUTPUT.hookSec + OUTPUT.demoSec, end: OUTPUT.hookSec + OUTPUT.demoSec + OUTPUT.ctaSec },
] as const;
const TOTAL = OUTPUT.hookSec + OUTPUT.demoSec + OUTPUT.ctaSec;

const segmentAt = (t: number) => SEGMENTS.find((s) => t < s.end) ?? SEGMENTS[SEGMENTS.length - 1]!;

/**
 * Review player for one 9:16 variation. Native <video> decoding, custom controls so the three parts of the ad
 * (hook, demo, CTA) are visible on the timeline and one click away. Space or K toggles play, arrows seek.
 */
export function VideoPreview({ src, title }: { src: string; title: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reloads, setReloads] = useState(0);

  // Smooth time readout while playing; `timeupdate` alone only fires a few times a second.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const loop = () => {
      const v = video.current;
      if (v) setTime(v.currentTime);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended || v.currentTime >= TOTAL - 0.05) v.currentTime = 0;
      v.play().catch(() => setState("error"));
    } else v.pause();
  }, []);

  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(TOTAL - 0.01, t));
    setTime(v.currentTime);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === " " || e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") seek(time + 1);
    else if (e.key === "ArrowLeft") seek(time - 1);
  };

  const current = segmentAt(time);

  return (
    <div className={styles.player} role="group" aria-label={`Preview: ${title}`}>
      <div className={styles.stage}>
        <div className={styles.hit} onClick={toggle} onKeyDown={onKey} tabIndex={0} role="button" aria-label={`${title}. Press space to play or pause, arrow keys to seek.`} />
        <video
          key={reloads}
          ref={video}
          className={styles.video}
          src={`${src}#t=0.1`}
          playsInline
          muted
          preload="auto"
          loop={loop}
          onLoadedData={() => setState("ready")}
          onCanPlay={() => setState("ready")}
          onWaiting={() => setState("loading")}
          onError={() => setState("error")}
          onPlay={() => setPlaying(true)}
          onPause={() => { setPlaying(false); if (video.current) setTime(video.current.currentTime); }}
          onEnded={() => { setPlaying(false); setTime(TOTAL); }}
        />
        {state === "loading" && <span className={styles.spinner} role="status" aria-label="Loading video" />}
        {state === "error" && (
          <div className={styles.error} role="alert">
            <p>This preview could not be played.</p>
            <button type="button" className={styles.link} onClick={() => { setState("loading"); setReloads((n) => n + 1); }}>Try again</button>
          </div>
        )}
        {state === "ready" && !playing && (
          <span className={styles.bigPlay} aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </span>
        )}
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.play} onClick={toggle} aria-label={playing ? "Pause" : "Play"} disabled={state === "error"}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" fill="currentColor" /> : <path d="M8 5v14l11-7z" fill="currentColor" />}
          </svg>
        </button>
        <div className={styles.scrub}>
          <input
            type="range"
            min={0}
            max={TOTAL}
            step={0.05}
            value={time}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            aria-valuetext={`${fmtTime(time)} of ${fmtTime(TOTAL)}, ${current.label}`}
            className={styles.range}
          />
          <span className={styles.ticks} aria-hidden="true">
            {SEGMENTS.map((s) => <span key={s.id} className={`${styles.tick} ${styles[s.id]}`} style={{ flexGrow: s.end - s.start }} />)}
          </span>
        </div>
        <span className={styles.time} aria-hidden="true">{fmtTime(time)} / {fmtTime(TOTAL)}</span>
      </div>

      <div className={styles.parts}>
        {SEGMENTS.map((s) => (
          <button key={s.id} type="button" className={`${styles.part} ${current.id === s.id ? styles.partActive : ""}`} onClick={() => seek(s.start)} aria-label={`Jump to ${s.label}, ${s.start} to ${s.end} seconds`}>
            <span className={`${styles.dot} ${styles[s.id]}`} aria-hidden="true" />
            {s.label}
            <span className={styles.partTime}>{s.start}–{s.end}s</span>
          </button>
        ))}
        <label className={styles.loop}>
          <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
          Loop
        </label>
      </div>
      <p className={styles.keys}>Focus the video, then Space plays/pauses and ← → seek 1 s</p>
    </div>
  );
}
