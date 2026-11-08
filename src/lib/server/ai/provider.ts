import type { ConceptRequest, FailureKind, TokenUsage } from "@/lib/types";

export interface IdeationInput extends Pick<ConceptRequest, "script" | "product" | "cta"> {
  brand: string;
  /** 3, 6 or 9. */
  count: 3 | 6 | 9;
}

export interface ProviderOutput {
  /** Raw JSON text exactly as returned, validated by the caller. */
  json: string;
  usage: TokenUsage | null;
}

/** A provider makes at most ONE upstream request per call and never retries. */
export interface IdeationProvider {
  readonly id: "mock" | "gemini";
  readonly model: string | null;
  generate(input: IdeationInput, signal: AbortSignal): Promise<ProviderOutput>;
}

export class ProviderError extends Error {
  constructor(readonly kind: FailureKind, message: string, readonly status?: number) {
    super(message);
  }
}
