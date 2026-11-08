import type { AiStatus, GenerationReport, ProviderId } from "@/lib/types";
import styles from "./AiBadge.module.scss";

export const fmtUsd = (n: number) => (n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Small header pill: which idea provider is active. Mock mode is always visible. */
export function AiBadge({ status, provider }: { status: AiStatus | null; provider: ProviderId }) {
  if (!status) return null;
  const live = provider === "gemini" && status.gemini.configured;
  return (
    <span
      className={`${styles.badge} ${live ? styles.live : ""}`}
      title={live ? "Script and product text are sent to Gemini to write hooks. The video is not." : "Offline, deterministic ideas. No AI calls, no cost."}
    >
      <span className={styles.dot} aria-hidden="true" />
      {live ? `Gemini · ${status.gemini.model}` : "Mock mode"}
    </span>
  );
}

/** One quiet line under the variations: provider, time, tokens, estimated cost. */
export function GenerationLine({ g }: { g: GenerationReport }) {
  const parts: string[] = [g.provider === "gemini" ? `Gemini ${g.model}` : "Mock ideas"];
  if (g.cached) parts.push("reused from this session, no new request");
  else parts.push(`${(g.durationMs / 1000).toFixed(1)} s`);
  if (g.usage) parts.push(`${g.usage.inputTokens.toLocaleString()} in / ${(g.usage.outputTokens + g.usage.thoughtTokens).toLocaleString()} out tokens`);
  const billed = g.provider === "gemini" && !g.cached && g.estimatedCostUsd != null;
  if (billed) parts.push(`est. ${fmtUsd(g.estimatedCostUsd as number)}`);
  return (
    <p className={styles.line} title="Estimated from list prices and reported tokens. The billed amount is not returned by the API; see your Google billing console.">
      {parts.join(" · ")}
      {billed && <span className={styles.est}> (estimate, not billed)</span>}
    </p>
  );
}
