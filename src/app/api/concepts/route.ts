import { NextResponse } from "next/server";
import { fail, forbidden, readJson, sameOrigin, tooMany } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/limits";
import { normalizeCount } from "@/lib/mock-provider";
import { ideate } from "@/lib/server/ai";
import { isSessionId, recordEvents } from "@/lib/server/analytics";
import { LIMITS, type ConceptRequest } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  if (!rateLimit("concepts", 30, 60_000)) return tooMany(); // protects AI spend from a loop or stray client
  const body = await readJson<Partial<ConceptRequest>>(req);
  const script = typeof body?.script === "string" ? body.script.trim() : "";
  const product = typeof body?.product === "string" ? body.product.trim() : "";
  const cta = typeof body?.cta === "string" ? body.cta.trim() : "";
  if (!script || !product || !cta) return fail("Script, product context and CTA are all required.");
  if (body?.count !== undefined && ![3, 6, 9].includes(body.count as number)) return fail("Ask for 3, 6 or 9 concepts.");
  if (script.length > LIMITS.maxScriptChars || product.length > LIMITS.maxProductChars || cta.length > LIMITS.maxCtaChars) {
    return fail("One of the fields is too long.");
  }
  const provider = body?.provider === "gemini" || body?.provider === "mock" ? body.provider : undefined;
  try {
    const res = await ideate({ script, product, cta, provider, force: body?.force === true, count: normalizeCount(body?.count) });
    const sid = body?.sessionId;
    if (isSessionId(sid)) {
      const g = res.generation;
      void recordEvents([{
        sid, type: "variations_generated", count: res.concepts.length, provider: g.provider, requestedProvider: g.requestedProvider,
        model: g.model, cached: g.cached, durationMs: g.durationMs, inputTokens: g.usage?.inputTokens ?? 0,
        outputTokens: g.usage?.outputTokens ?? 0, thoughtTokens: g.usage?.thoughtTokens ?? 0,
        estimatedCostUsd: g.cached ? 0 : (g.estimatedCostUsd ?? 0), fallback: g.fallback?.reason ?? null, replaced: g.replaced.length,
      }]);
    }
    return NextResponse.json(res);
  } catch {
    return fail("Could not create ideas. Please try again.", 500);
  }
}
