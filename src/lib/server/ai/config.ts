import type { AiStatus, ProviderId } from "@/lib/types";

/** Server-only. Nothing here may be imported from a client component. */

// gemini-3.1-flash-lite: stable, cheapest current-generation Flash-Lite open to new API users (checked 2026-11-08
// against the official models and pricing pages). Override with GEMINI_MODEL; prices with AI_PRICE_*.
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_PRICES = { inputPerM: 0.25, outputPerM: 1.5 }; // USD per 1M tokens, text input / output incl. thinking

function num(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export const geminiKey = (): string | null => process.env.GEMINI_API_KEY?.trim() || null;
export const geminiModel = (): string => process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
export const geminiBaseUrl = (): string | undefined => process.env.GEMINI_BASE_URL?.trim() || undefined;

/** AI_MAX_OUTPUT_TOKENS is the budget for a 3-concept request; it scales with the requested count (capped at 16384). */
export const aiLimits = (count = 3) => ({
  timeoutMs: num("AI_TIMEOUT_MS", 20_000, 2_000, 60_000) + (count > 3 ? 10_000 : 0),
  maxOutputTokens: Math.min(16384, Math.round((num("AI_MAX_OUTPUT_TOKENS", 2048, 256, 8192) * count) / 3)),
});

export const prices = () => ({
  inputPerM: num("AI_PRICE_INPUT_PER_M", DEFAULT_PRICES.inputPerM, 0, 1000),
  outputPerM: num("AI_PRICE_OUTPUT_PER_M", DEFAULT_PRICES.outputPerM, 0, 1000),
});

export function aiStatus(): AiStatus {
  const configured = Boolean(geminiKey());
  const wanted = process.env.AI_PROVIDER?.trim().toLowerCase();
  // Gemini is opt-in: only the default when explicitly selected AND a key exists.
  const defaultProvider: ProviderId = wanted === "gemini" && configured ? "gemini" : "mock";
  return { defaultProvider, gemini: { configured, model: geminiModel() } };
}
