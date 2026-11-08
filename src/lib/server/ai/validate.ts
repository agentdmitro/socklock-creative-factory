import { ANGLES, templateFor } from "../../mock-provider";
import { CONCEPT_IDS, LIMITS, type Concept, type ConceptId } from "../../types";
import { unsupportedClaims } from "./guard";

/** Wire keys the model must use, one per requested angle (the first `count` of ANGLES). */
export const ANGLE_KEYS = ANGLES.map((a) => a.key);

export interface Parsed {
  /** Valid concepts by id. Slots that failed validation are absent. */
  ok: Partial<Record<ConceptId, Concept>>;
  /** Human-readable reasons (no model text is quoted, so nothing sensitive reaches logs). */
  problems: string[];
}

const str = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (t: string) => new Set(norm(t).split(" ").filter((w) => w.length > 2));

/** Share of words two texts have in common (0 to 1). Used to reject paraphrases, not just identical lines. */
export function overlap(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return norm(a) === norm(b) ? 1 : 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size);
}

/** Two hooks or opening lines that share more than this are treated as the same idea reworded. */
export const MAX_OVERLAP = 0.7;

/** Strips an accidental ```json fence; structured output normally makes this unnecessary. */
function parseJson(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(t);
}

/** Runtime validation of the model's JSON. `facts` is the user's own text (product, script, CTA). */
export function validateConcepts(raw: string, facts: string, count: number): Parsed {
  const out: Parsed = { ok: {}, problems: [] };
  let data: unknown;
  try {
    data = parseJson(raw);
  } catch {
    out.problems.push("response was not valid JSON");
    return out;
  }
  const list = (data as { concepts?: unknown } | null)?.concepts;
  if (!Array.isArray(list)) {
    out.problems.push("response has no concepts array");
    return out;
  }

  const seen: { hook: string; line: string }[] = [];
  ANGLES.slice(0, count).forEach((angle, i) => {
    const id = CONCEPT_IDS[i]!;
    const label = angle.label;
    const matches = list.filter((v) => (v as { angle?: unknown } | null)?.angle === angle.key);
    if (matches.length !== 1) {
      out.problems.push(`${label}: expected exactly one concept, got ${matches.length}`);
      return;
    }
    const v = matches[0] as Record<string, unknown>;
    const hook = str(v.hook);
    const openingLine = str(v.openingLine);
    const onScreenText = str(v.onScreenText);
    const cta = str(v.cta);
    const rationale = str(v.rationale);

    const issues: string[] = [];
    if (!hook || hook.length > LIMITS.maxHookChars) issues.push(`hook must be 1–${LIMITS.maxHookChars} characters`);
    if (!openingLine || openingLine.length > LIMITS.maxOpeningChars) issues.push(`opening line must be 1–${LIMITS.maxOpeningChars} characters`);
    if (!onScreenText || onScreenText.length > LIMITS.maxCaptionChars) issues.push(`on-screen text must be 1–${LIMITS.maxCaptionChars} characters`);
    if (!cta || cta.length > LIMITS.maxCtaChars) issues.push(`CTA must be 1–${LIMITS.maxCtaChars} characters`);
    if (!rationale) issues.push("missing explanation");
    if (seen.some((s) => overlap(s.hook, hook) > MAX_OVERLAP)) issues.push("hook repeats another concept");
    if (seen.some((s) => overlap(s.line, openingLine) > MAX_OVERLAP)) issues.push("opening line repeats another concept");
    if (!issues.length) {
      const claims = unsupportedClaims(`${hook}\n${openingLine}\n${onScreenText}\n${cta}`, facts);
      if (claims.length) issues.push(`unsupported claims: ${claims.join("; ")}`);
    }
    if (issues.length) {
      out.problems.push(`${label}: ${issues.join("; ")}`);
      return;
    }
    seen.push({ hook, line: openingLine });
    out.ok[id] = { id, template: templateFor(i), angle: label, hook, openingLine, onScreenText, cta, rationale: rationale.slice(0, LIMITS.maxRationaleChars) };
  });
  return out;
}
