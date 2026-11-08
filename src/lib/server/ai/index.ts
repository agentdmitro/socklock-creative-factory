import { createHash } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { deriveBrand, generateConcepts, normalizeCount } from "@/lib/mock-provider";
import type { Concept, ConceptId, ConceptRequest, ConceptResponse, FailureKind, GenerationReport, ProviderId, TokenUsage } from "@/lib/types";
import { aiLimits, aiStatus, prices } from "./config";
import { GeminiProvider } from "./gemini";
import { MockProvider } from "./mock";
import { ProviderError, type IdeationProvider } from "./provider";
import { validateConcepts } from "./validate";

/**
 * One batch request (all 3, 6 or 9 concepts) per user action. No retries, no calls from render paths.
 * Identical requests within CACHE_TTL_MS are answered from memory, and concurrent identical requests share one call,
 * so double clicks, React re-renders and Back/Continue cannot trigger duplicate spend.
 */

const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 20;
type Cached = { at: number; res: ConceptResponse };
const cache = new Map<string, Cached>();
const inflight = new Map<string, Promise<ConceptResponse>>();

const keyOf = (provider: ProviderId, model: string | null, r: ConceptRequest) =>
  createHash("sha256").update(JSON.stringify([provider, model, r.script, r.product, r.cta, normalizeCount(r.count)])).digest("hex");

export function estimateCostUsd(u: TokenUsage): number {
  const p = prices();
  return (u.inputTokens * p.inputPerM + (u.outputTokens + u.thoughtTokens) * p.outputPerM) / 1_000_000;
}

function maxCostUsd(r: ConceptRequest): number {
  const p = prices();
  const inputTokens = Math.ceil((r.script.length + r.product.length + r.cta.length) / 2) + 900 + 60 * normalizeCount(r.count); // generous: ~2 chars/token + prompt
  return (inputTokens * p.inputPerM + aiLimits(normalizeCount(r.count)).maxOutputTokens * p.outputPerM) / 1_000_000;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export async function ideate(req: ConceptRequest): Promise<ConceptResponse> {
  const status = aiStatus();
  const requested: ProviderId = req.provider ?? status.defaultProvider;
  const useGemini = requested === "gemini" && status.gemini.configured;
  const provider: IdeationProvider = useGemini ? new GeminiProvider() : new MockProvider();
  const brand = deriveBrand(req.product);
  req = { ...req, count: normalizeCount(req.count) };

  const base: Omit<GenerationReport, "durationMs" | "usage" | "estimatedCostUsd" | "fallback" | "replaced" | "errors" | "cached"> = {
    requestedProvider: requested,
    provider: provider.id,
    model: provider.model,
    billedCostUsd: null,
    maxCostUsd: useGemini ? round6(maxCostUsd(req)) : null,
    count: req.count as number,
  };
  const t0 = Date.now();

  if (!useGemini) {
    const fallback = requested === "gemini" ? { reason: "not_configured" as FailureKind, message: "Gemini is not configured (no GEMINI_API_KEY). Using Mock mode." } : null;
    const res: ConceptResponse = {
      brand,
      concepts: generateConcepts(req),
      generation: { ...base, durationMs: Date.now() - t0, cached: false, usage: null, estimatedCostUsd: null, fallback, replaced: [], errors: [] },
    };
    return res;
  }

  const key = keyOf("gemini", provider.model, req);
  const hit = cache.get(key);
  if (!req.force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    const g = hit.res.generation;
    return { ...hit.res, generation: { ...g, cached: true, durationMs: Date.now() - t0, usage: null, estimatedCostUsd: 0, maxCostUsd: null } };
  }
  const pending = inflight.get(key);
  if (pending) return pending;

  const run = callGemini(provider, req, brand, base, t0).then((res) => {
    const g = res.generation;
    if (!g.fallback && !g.replaced.length) {
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
      cache.set(key, { at: Date.now(), res });
    }
    return res;
  });
  inflight.set(key, run);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

async function callGemini(
  provider: IdeationProvider,
  req: ConceptRequest,
  brand: string,
  base: Pick<GenerationReport, "requestedProvider" | "provider" | "model" | "billedCostUsd" | "maxCostUsd" | "count">,
  t0: number,
): Promise<ConceptResponse> {
  const fallbackConcepts = generateConcepts(req);
  const finish = (concepts: Concept[], extra: Partial<GenerationReport>): ConceptResponse => {
    const usage = extra.usage ?? null;
    const generation: GenerationReport = {
      ...base,
      durationMs: Date.now() - t0,
      cached: false,
      usage,
      estimatedCostUsd: usage ? round6(estimateCostUsd(usage)) : null,
      fallback: null,
      replaced: [],
      errors: [],
      ...extra,
    };
    void record(generation);
    return { brand, concepts, generation };
  };

  try {
    const count = normalizeCount(req.count);
    const { timeoutMs } = aiLimits(count);
    const out = await provider.generate({ ...req, brand, count }, AbortSignal.timeout(timeoutMs));
    const facts = `${req.product}\n${req.script}\n${req.cta}`;
    const parsed = validateConcepts(out.json, facts, count);
    const replaced: ConceptId[] = [];
    const concepts = fallbackConcepts.map((fb) => {
      const good = parsed.ok[fb.id];
      if (good) return good;
      replaced.push(fb.id);
      return fb;
    });
    if (replaced.length === count) {
      return finish(concepts, {
        usage: out.usage,
        replaced: [],
        errors: parsed.problems,
        fallback: { reason: "invalid_response", message: "The AI response failed validation, so Mock ideas are shown instead. Nothing was retried." },
      });
    }
    return finish(concepts, { usage: out.usage, replaced, errors: parsed.problems });
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("unknown", "Unexpected AI error.");
    return finish(fallbackConcepts, { fallback: { reason: e.kind, message: `${e.message} Using Mock ideas instead.` }, errors: [e.message] });
  }
}

/** Metadata only: never prompts, source text, copy or credentials. */
async function record(g: GenerationReport): Promise<void> {
  const line = {
    at: new Date().toISOString(),
    provider: g.provider,
    model: g.model,
    durationMs: g.durationMs,
    usage: g.usage,
    estimatedCostUsd: g.estimatedCostUsd,
    fallback: g.fallback?.reason ?? null,
    replaced: g.replaced.length,
    errors: g.errors.length,
  };
  console.info(`[ai] ${JSON.stringify(line)}`);
  try {
    const dir = path.join(process.cwd(), ".tmp");
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "ai-usage.jsonl"), `${JSON.stringify({ ...line, errorMessages: g.errors })}\n`);
  } catch {
    /* the ledger is best-effort */
  }
}
