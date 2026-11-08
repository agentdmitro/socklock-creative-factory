import { NextResponse } from "next/server";
import { CLIENT_EVENT_TYPES, type EventType, type Scalar } from "@/lib/analytics";
import { recordEvents, isSessionId } from "@/lib/server/analytics";
import { fail, forbidden, readJson, sameOrigin, tooMany } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/limits";
import { isConceptId } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only these properties are ever stored from the browser, each with a strict type. */
const NUMBERS = ["activeMs", "waitUploadMs", "waitAiMs", "waitRenderMs", "segmentEdits", "charsChanged", "chars", "activeIdeationMs"] as const;

/** Receives human-action events from the browser. Everything else is recorded by the server where it happens. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  if (!rateLimit("events", 300, 60_000)) return tooMany();
  const body = await readJson<{ events?: unknown }>(req);
  if (!body || !Array.isArray(body.events) || body.events.length === 0 || body.events.length > 20) return fail("Invalid events.");
  const accepted: { sid: string; type: EventType; [k: string]: Scalar }[] = [];
  for (const raw of body.events as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type as EventType;
    if (!CLIENT_EVENT_TYPES.includes(type) || !isSessionId(raw.sid)) continue;
    const e: { sid: string; type: EventType; [k: string]: Scalar } = { sid: raw.sid, type };
    if (type === "session_started") {
      if (raw.origin !== "interactive" && raw.origin !== "scripted") continue;
      e.origin = raw.origin;
    }
    if (type.startsWith("variant_") || type.startsWith("concept_")) {
      if (!isConceptId(raw.variant)) continue;
      e.variant = raw.variant;
    }
    if (type === "variant_edited" && typeof raw.fields === "string") e.fields = raw.fields.replace(/[^a-zA-Z,]/g, "").slice(0, 40);
    if (type === "session_time" || type === "variant_edited") {
      for (const k of NUMBERS) if (typeof raw[k] === "number" && Number.isFinite(raw[k])) e[k] = Math.max(0, Math.round(raw[k] as number));
      if (type === "session_time" && raw.activeMs === null) e.activeMs = null; // explicit: nobody was measured
    }
    accepted.push(e);
  }
  if (!accepted.length) return fail("No valid events.");
  await recordEvents(accepted);
  return NextResponse.json({ ok: true, recorded: accepted.length });
}
