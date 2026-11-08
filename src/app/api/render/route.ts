import { NextResponse } from "next/server";
import { isSessionId, recordEvents } from "@/lib/server/analytics";
import { fail, forbidden, readJson, sameOrigin } from "@/lib/server/http";
import { Semaphore } from "@/lib/server/limits";
import { isConceptId, isTemplateId } from "@/lib/server/jobs";
import { RenderInputError, renderVariant } from "@/lib/server/render";
import type { RenderRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** At most two FFmpeg renders at once, however many requests arrive. */
const renderSlots = new Semaphore(2);

/** Renders ONE variant per request so the client can show per-variant progress and retry individually. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  const b = await readJson<Partial<RenderRequest>>(req);
  const c = b?.concept;
  if (
    !b || typeof b.jobId !== "string" || typeof b.startSec !== "number" || typeof b.endSec !== "number" ||
    (b.fit !== "contain" && b.fit !== "cover") || typeof b.cta !== "string" || typeof b.brand !== "string" ||
    !c || !isConceptId(c.id) || !isTemplateId(c.template) || typeof c.hook !== "string" || typeof c.onScreenText !== "string" || typeof c.angle !== "string"
  ) {
    return fail("Invalid render request.");
  }
  const { jobId, startSec, endSec, fit, cta, brand } = b;
  const sid = isSessionId(b.sessionId) ? b.sessionId : null;
  const t0 = Date.now();
  const log = (ok: boolean, extra: Record<string, string | number | boolean | null>) =>
    sid && void recordEvents([{ sid, type: "render_completed", variant: c.id, ok, durationMs: Date.now() - t0, ...extra }]);
  try {
    const result = await renderSlots.run(() => renderVariant({
      jobId, startSec, endSec, fit, cta: cta.trim(), brand: brand.trim(),
      concept: {
        id: c.id, template: c.template, angle: c.angle, hook: c.hook.trim(), openingLine: typeof c.openingLine === "string" ? c.openingLine : "",
        onScreenText: c.onScreenText.trim(), cta: cta.trim(), rationale: typeof c.rationale === "string" ? c.rationale : "",
      },
    }));
    const renderMs = Date.now() - t0;
    log(true, { sizeBytes: result.sizeBytes });
    return NextResponse.json({ ...result, renderMs });
  } catch (err) {
    if (err instanceof RenderInputError) {
      log(false, { errorKind: "input" });
      return fail(err.message, 422);
    }
    log(false, { errorKind: "unexpected" });
    return fail("Rendering failed unexpectedly. Please try again.", 500);
  }
}
