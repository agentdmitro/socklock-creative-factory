"use client";

import { useEffect, useState } from "react";
import type { EventType, Origin } from "@/lib/analytics";
import type { ConceptId } from "@/lib/types";

/** A gap between two interactions longer than this is treated as idle (away from the keyboard), not hands-on time. */
export const IDLE_CAP_MS = 15_000;
const EDIT_DEBOUNCE_MS = 800;

export type WaitKind = "upload" | "ai" | "render";
/** Which half of the work the hands-on clock is running for: ideas (brief, concepts) or video (render setup, review). */
export type Phase = "ideation" | "video";

export interface SessionSummary {
  activeSec: number;
  /** Hands-on seconds spent on ideas (the rest of activeSec is video work). */
  ideationSec: number;
  waitSec: number;
  segmentEdits: number;
  charsChanged: number;
}

const uuid = (): string => {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // crypto.randomUUID needs a secure context; plain-http LAN access has only getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

type Payload = { type: EventType; [k: string]: string | number | boolean | null };

/**
 * Measures one working session in the browser.
 *  - Hands-on time = gaps between real interactions (pointer, keys, typing, video playback), each capped at IDLE_CAP_MS.
 *  - Waiting time = upload, AI and render durations. The hands-on clock is stopped while anything is in progress.
 *  - Time is paused while the Insights view is open (reading reports is not production work).
 * Events are fire-and-forget: a failed request never affects the user, it just leaves a gap in the log.
 */
export class SessionTracker {
  sid: string | null = null;
  private last = 0;
  private activeMs = 0;
  private ideationMs = 0;
  private phase: Phase = "ideation";
  private paused = false;
  private waits = { upload: 0, ai: 0, render: 0 };
  private waitStart: Partial<Record<WaitKind, number>> = {};
  private segmentEdits = 0;
  private charsChanged = 0;
  private edits = new Map<ConceptId, { fields: Set<string>; chars: number }>();
  private editTimer: number | null = null;

  /** Starts a session (once). Called when the user commits to work by uploading a source. */
  begin(): string {
    if (this.sid) return this.sid;
    this.sid = uuid();
    this.last = Date.now();
    this.send([{ type: "session_started", origin: "interactive" satisfies Origin }]);
    return this.sid;
  }

  /** Forget the current session; the next begin() starts a fresh one. */
  end() {
    this.flushEdits();
    this.sid = null;
    this.activeMs = 0;
    this.ideationMs = 0;
    this.phase = "ideation";
    this.waits = { upload: 0, ai: 0, render: 0 };
    this.waitStart = {};
    this.segmentEdits = 0;
    this.charsChanged = 0;
    this.paused = false;
  }

  touch = () => {
    if (!this.sid || this.paused || Object.keys(this.waitStart).length) return;
    const now = Date.now();
    const gap = Math.min(now - this.last, IDLE_CAP_MS);
    this.activeMs += gap;
    if (this.phase === "ideation") this.ideationMs += gap;
    this.last = now;
  };

  /** Switches the hands-on clock between idea work and video work. Time up to now belongs to the previous phase. */
  setPhase(phase: Phase) {
    if (phase === this.phase) return;
    this.touch();
    this.phase = phase;
  }

  startWait(kind: WaitKind) {
    if (!this.sid) return;
    this.touch();
    this.waitStart[kind] = Date.now();
  }

  endWait(kind: WaitKind) {
    const start = this.waitStart[kind];
    if (start === undefined) return;
    this.waits[kind] += Date.now() - start;
    delete this.waitStart[kind];
    this.last = Date.now();
  }

  pause() {
    this.touch();
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.last = Date.now();
  }

  countSegmentEdit() {
    this.segmentEdits++;
  }

  addChars(n: number) {
    this.charsChanged += Math.max(0, Math.round(n));
  }

  /** Records that a variant's inputs changed. Bursts of typing become one event. */
  noteEdit(variant: ConceptId, field: string, chars = 0) {
    if (!this.sid) return;
    const e = this.edits.get(variant) ?? { fields: new Set<string>(), chars: 0 };
    e.fields.add(field);
    e.chars += chars;
    this.edits.set(variant, e);
    if (this.editTimer !== null) window.clearTimeout(this.editTimer);
    this.editTimer = window.setTimeout(() => this.flushEdits(), EDIT_DEBOUNCE_MS);
  }

  flushEdits() {
    if (this.editTimer !== null) window.clearTimeout(this.editTimer);
    this.editTimer = null;
    if (!this.edits.size) return;
    const batch = [...this.edits].map(([variant, e]): Payload => ({ type: "variant_edited", variant, fields: [...e.fields].sort().join(","), chars: e.chars }));
    this.edits.clear();
    this.send(batch);
  }

  summary(): SessionSummary {
    const waitMs = this.waits.upload + this.waits.ai + this.waits.render;
    return { activeSec: Math.round(this.activeMs / 1000), ideationSec: Math.round(this.ideationMs / 1000), waitSec: Math.round(waitMs / 1000), segmentEdits: this.segmentEdits, charsChanged: this.charsChanged };
  }

  /** Reports a human decision or milestone, followed by a cumulative time snapshot. */
  /** A download the browser made itself (stateless hosts); on other hosts the server logs it when it serves the file. */
  exported(variant: ConceptId) {
    if (!this.sid) return;
    this.send([{ type: "variant_exported", variant }]);
  }

  track(type: "concept_approved" | "concept_rejected" | "variant_accepted" | "variant_rejected" | "session_completed", variant?: ConceptId) {
    if (!this.sid) return;
    this.touch();
    this.flushEdits(); // keep the log in the order things happened
    this.send([variant ? { type, variant } : { type }, this.snapshot()]);
  }

  /** Cumulative time so far; also sent when the page is hidden so a closed tab loses nothing. */
  snapshot(): Payload {
    return {
      type: "session_time",
      activeMs: Math.round(this.activeMs),
      activeIdeationMs: Math.round(this.ideationMs),
      waitUploadMs: Math.round(this.waits.upload),
      waitAiMs: Math.round(this.waits.ai),
      waitRenderMs: Math.round(this.waits.render),
      segmentEdits: this.segmentEdits,
      charsChanged: this.charsChanged,
    };
  }

  flushOnHide = () => {
    if (!this.sid) return;
    this.flushEdits();
    this.send([this.snapshot()], true);
  };

  private send(events: Payload[], beacon = false) {
    if (!this.sid) return;
    const body = JSON.stringify({ events: events.map((e) => ({ ...e, sid: this.sid })) });
    try {
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch {
      /* analytics is best effort */
    }
  }
}

const ACTIVITY = ["pointerdown", "keydown", "input", "play", "pause", "seeked", "timeupdate"] as const;

/** One tracker for the page, wired to real user activity (including video playback while reviewing). */
export function useSessionTracker(): SessionTracker {
  const [tracker] = useState(() => new SessionTracker());
  useEffect(() => {
    // Media events do not bubble, so they are caught in the capture phase on window.
    ACTIVITY.forEach((e) => window.addEventListener(e, tracker.touch, true));
    const onHide = () => document.visibilityState === "hidden" && tracker.flushOnHide();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", tracker.flushOnHide);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, tracker.touch, true));
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", tracker.flushOnHide);
    };
  }, [tracker]);
  return tracker;
}
