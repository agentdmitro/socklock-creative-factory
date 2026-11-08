import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AnalyticsEvent, EventType, Scalar } from "@/lib/analytics";
import { isJobId } from "./jobs";

/**
 * Durable local store: one append-only JSON-lines file (`data/events.jsonl`, override with CVF_DATA_DIR).
 * Why a file: single user, no deploy, trivially inspectable and copyable, and a crashed write can only damage
 * the last line (readers skip unparsable lines). No external service, no accounts, no user profile.
 * It stores counts, durations, ids and costs only: never script text, copy, file names or prompts.
 */

// On Vercel the project folder is read-only; /tmp is writable but temporary, so Insights there only lasts a while.
export const dataDir = () => process.env.CVF_DATA_DIR?.trim() || (process.env.VERCEL ? path.join(os.tmpdir(), "cvf-data") : path.join(process.cwd(), "data"));
const eventsFile = () => path.join(dataDir(), "events.jsonl");

/** Session ids share the UUID shape used for job ids. */
export const isSessionId = (v: unknown): v is string => typeof v === "string" && isJobId(v);

let chain: Promise<unknown> = Promise.resolve();

/** Best effort and ordered: analytics must never break or slow the product. */
export function recordEvents(events: { sid: string; type: EventType; [prop: string]: Scalar }[]): Promise<void> {
  const ts = new Date().toISOString();
  const lines = events.map((e) => JSON.stringify({ ts, ...clean(e) })).join("\n") + "\n";
  const write = async () => {
    try {
      await mkdir(dataDir(), { recursive: true });
      await appendFile(eventsFile(), lines);
    } catch (err) {
      console.warn("[analytics] could not write the event log:", err instanceof Error ? err.message : err);
    }
  };
  chain = chain.then(write, write);
  return chain as Promise<void>;
}

/** Drops anything that is not a short scalar, so a bug elsewhere cannot leak text into the log. */
function clean(e: Record<string, Scalar>): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(e)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(k)) continue;
    if (typeof v === "string") out[k] = v.slice(0, 80);
    else if (typeof v === "number") out[k] = Number.isFinite(v) ? v : null;
    else if (typeof v === "boolean" || v === null) out[k] = v;
  }
  return out;
}

let parsed: { file: string; mtimeMs: number; size: number; events: AnalyticsEvent[] } | null = null;

/** Re-parses the log only when the file changed (Insights and CSV exports poll it). */
export async function readEvents(): Promise<AnalyticsEvent[]> {
  const file = eventsFile();
  let raw: string;
  try {
    const st = await stat(file);
    if (parsed && parsed.file === file && parsed.mtimeMs === st.mtimeMs && parsed.size === st.size) return parsed.events;
    raw = await readFile(file, "utf8");
    const events = parseEvents(raw);
    parsed = { file, mtimeMs: st.mtimeMs, size: st.size, events };
    return events;
  } catch {
    return [];
  }
}

function parseEvents(raw: string): AnalyticsEvent[] {
  const out: AnalyticsEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as AnalyticsEvent;
      if (typeof e.ts === "string" && typeof e.sid === "string" && typeof e.type === "string") out.push(e);
    } catch {
      /* torn or hand-edited line: skip */
    }
  }
  return out;
}
