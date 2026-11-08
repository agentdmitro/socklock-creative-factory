export type FitMode = "contain" | "cover";
export type TemplateId = "statement" | "editorial" | "spotlight";

export interface SourceInfo {
  jobId: string;
  fileName: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  sizeBytes: number;
  warnings: string[];
}

/** How many concepts one request may ask for. */
export const CONCEPT_COUNTS = [3, 6, 9] as const;
export const DEFAULT_CONCEPT_COUNT = 6;
/** Videos in one batch: three to start with, at most five. */
export const DEFAULT_RENDER_COUNT = 3;
export const MAX_RENDER_COUNT = 5;

/** Stable slot ids. They name output files and analytics rows, so they are an enum, never free text. */
export const CONCEPT_IDS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"] as const;
export type ConceptId = (typeof CONCEPT_IDS)[number];

/** Human review of an idea, before any video exists. */
export type ConceptStatus = "pending" | "approved" | "rejected";

export interface Concept {
  id: ConceptId;
  /** Visual template used when this concept is rendered (the three templates are reused across concepts). */
  template: TemplateId;
  /** Display name of the creative angle, e.g. "Pain-first". */
  angle: string;
  /** On-screen hook for the first ~2 seconds (rendered). */
  hook: string;
  /** First sentence for a presenter or voice-over. Also shown as a subtitle under the hook in the video. */
  openingLine: string;
  /** Supporting on-screen text shown over the demo (rendered). */
  onScreenText: string;
  /** Call to action on the end card (rendered). */
  cta: string;
  /** One-line explanation of the creative angle (not rendered into the video). */
  rationale: string;
}

/** Editable copy fields of a concept. */
export type CopyField = "hook" | "openingLine" | "onScreenText" | "cta";
export const COPY_FIELDS: readonly CopyField[] = ["hook", "openingLine", "onScreenText", "cta"];

export type ProviderId = "mock" | "gemini";

export interface ConceptRequest {
  script: string;
  product: string;
  cta: string;
  /** Number of distinct concepts to create: 3, 6 or 9 (default 6). */
  count?: number;
  /** Requested provider; the server falls back to mock when it is unavailable. */
  provider?: ProviderId;
  /** Skip the short-lived server cache and spend a new request. Only set by an explicit user action. */
  force?: boolean;
  /** Local analytics session this request belongs to (optional; nothing is recorded without it). */
  sessionId?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  totalTokens: number;
}

/** What happened during one generation call. Costs are estimates from list prices, never billed amounts. */
export interface GenerationReport {
  requestedProvider: ProviderId;
  provider: ProviderId;
  model: string | null;
  durationMs: number;
  /** True when the answer came from the in-memory cache (no new request was made). */
  cached: boolean;
  usage: TokenUsage | null;
  /** Estimated from published list prices x reported tokens. null when no tokens were billed or reported. */
  estimatedCostUsd: number | null;
  /** The provider APIs do not return the billed amount, so this is always null. Check your Google billing console. */
  billedCostUsd: null;
  /** Upper bound for one request given the output token cap. */
  maxCostUsd: number | null;
  /** Set when the requested provider could not be used and mock output was shown instead. */
  fallback: { reason: FailureKind; message: string } | null;
  /** How many concepts were requested. */
  count: number;
  /** Concepts (by id) replaced by deterministic fallback because they failed validation. */
  replaced: ConceptId[];
  errors: string[];
}

export type FailureKind = "not_configured" | "quota" | "auth" | "timeout" | "network" | "invalid_response" | "blocked" | "unknown";

export interface ConceptResponse {
  brand: string;
  concepts: Concept[];
  generation: GenerationReport;
}

export interface AiStatus {
  defaultProvider: ProviderId;
  gemini: { configured: boolean; model: string };
}

export interface RenderRequest {
  jobId: string;
  startSec: number;
  endSec: number;
  fit: FitMode;
  cta: string;
  brand: string;
  concept: Concept;
  sessionId?: string;
}

export interface RenderResult {
  file: string;
  /** Duration of the rendered video. */
  durationSec: number;
  /** How long the server took to render it. */
  renderMs: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface HealthReport {
  ok: boolean;
  ffmpeg: string | null;
  ffprobe: string | null;
  font: string | null;
  problems: string[];
  ai: AiStatus;
}

export interface ApiError {
  error: string;
}

export const LIMITS = {
  maxUploadBytes: 200 * 1024 * 1024,
  minSourceSec: 3,
  maxSourceSec: 30 * 60,
  minShortSidePx: 240,
  minSegmentSec: 3,
  maxSegmentSec: 12,
  maxScriptChars: 4000,
  maxProductChars: 400,
  maxCtaChars: 28,
  maxHookChars: 70,
  maxCaptionChars: 50,
  maxReasonChars: 200,
  maxOpeningChars: 120,
  maxRationaleChars: 160,
} as const;

export const OUTPUT = { width: 720, height: 1280, fps: 30, hookSec: 2, demoSec: 6, ctaSec: 2 } as const;
