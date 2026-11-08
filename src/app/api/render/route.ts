import { NextResponse } from "next/server";
import { isSessionId, recordEvents } from "@/lib/server/analytics";
import { fail, forbidden, readJson, sameOrigin } from "@/lib/server/http";
import { Semaphore } from "@/lib/server/limits";
import { createJob, isConceptId, isTemplateId, outputPath, removeJob, sourcePath } from "@/lib/server/jobs";
import { readFile, writeFile } from "node:fs/promises";
import { RenderInputError, renderVariant } from "@/lib/server/render";
import { LIMITS, type RenderRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // a render takes seconds; 60 s fits every Vercel plan

/** At most two FFmpeg renders at once, however many requests arrive. */
const renderSlots = new Semaphore(2);

/** Renders ONE variant per request so the client can show per-variant progress and retry individually. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  // Stateless hosts send the video itself as multipart; otherwise the request is JSON that points at an uploaded job.
  const inline = (req.headers.get("content-type") ?? "").startsWith("multipart/form-data");
  let b: Partial<RenderRequest> | null;
  let upload: File | null = null;
  if (inline) {
    try {
      const form = await req.formData();
      b = JSON.parse(String(form.get("meta"))) as Partial<RenderRequest>;
      const f = form.get("file");
      upload = f instanceof File ? f : null;
    } catch {
      return fail("Invalid render request.");
    }
    if (!upload || upload.size === 0 || upload.size > LIMITS.maxUploadBytes) return fail("The source video is missing or too large.", 413);
    b = { ...b, jobId: await createJob() };
  } else {
    b = await readJson<Partial<RenderRequest>>(req);
  }
  const c = b?.concept;
  if (
    !b || typeof b.jobId !== "string" || typeof b.startSec !== "number" || typeof b.endSec !== "number" ||
    (b.fit !== "contain" && b.fit !== "cover") || typeof b.cta !== "string" || typeof b.brand !== "string" ||
    !c || !isConceptId(c.id) || !isTemplateId(c.template) || typeof c.hook !== "string" || typeof c.onScreenText !== "string" || typeof c.angle !== "string"
  ) {
    if (inline && typeof b?.jobId === "string") await removeJob(b.jobId);
    return fail("Invalid render request.");
  }
  const { jobId, startSec, endSec, fit, cta, brand } = b;
  const sid = isSessionId(b.sessionId) ? b.sessionId : null;
  const t0 = Date.now();
  const log = (ok: boolean, extra: Record<string, string | number | boolean | null>) =>
    sid && void recordEvents([{ sid, type: "render_completed", variant: c.id, ok, durationMs: Date.now() - t0, ...extra }]);
  try {
    if (inline && upload) await writeFile(sourcePath(jobId), Buffer.from(await upload.arrayBuffer()));
    const result = await renderSlots.run(() => renderVariant({
      jobId, startSec, endSec, fit, cta: cta.trim(), brand: brand.trim(),
      concept: {
        id: c.id, template: c.template, angle: c.angle, hook: c.hook.trim(), openingLine: typeof c.openingLine === "string" ? c.openingLine : "",
        onScreenText: c.onScreenText.trim(), cta: cta.trim(), rationale: typeof c.rationale === "string" ? c.rationale : "",
      },
    }));
    const renderMs = Date.now() - t0;
    log(true, { sizeBytes: result.sizeBytes });
    if (inline) {
      const video = await readFile(outputPath(jobId, result.file));
      const meta = encodeURIComponent(JSON.stringify({ ...result, renderMs }));
      return new Response(new Blob([new Uint8Array(video)], { type: "video/mp4" }), { headers: { "Content-Type": "video/mp4", "x-render-result": meta, "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ ...result, renderMs });
  } catch (err) {
    if (err instanceof RenderInputError) {
      log(false, { errorKind: "input" });
      return fail(err.message, 422);
    }
    log(false, { errorKind: "unexpected" });
    return fail("Rendering failed unexpectedly. Please try again.", 500);
  } finally {
    if (inline) await removeJob(jobId); // nothing stays on the server
  }
}
