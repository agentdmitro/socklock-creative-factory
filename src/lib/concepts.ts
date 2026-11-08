import { LIMITS, type Concept, type ConceptId, type ConceptStatus, type CopyField } from "./types";

/** Pure helpers for reviewing concepts and choosing which ones become videos. Shared by the UI and the unit tests. */

/** Characters actually changed between two texts: what is left after removing the common start and end. */
export function editSize(before: string, after: string): number {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;
  let end = 0;
  while (end < max - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return Math.max(before.length - start - end, after.length - start - end);
}

/** Concepts that will become videos: the ones marked for video, in list order. */
export const selectedConcepts = (concepts: readonly Concept[], status: Partial<Record<ConceptId, ConceptStatus>>): Concept[] =>
  concepts.filter((c) => status[c.id] === "approved");

/** A new batch starts with the first few concepts selected for video; the rest are available to switch on. */
export function initialStatus(concepts: readonly Concept[], videos: number): Record<string, ConceptStatus> {
  return Object.fromEntries(concepts.map((c, i) => [c.id, i < videos ? "approved" : "rejected"]));
}

export const FIELD_MAX: Record<CopyField, number> = {
  hook: LIMITS.maxHookChars,
  openingLine: LIMITS.maxOpeningChars,
  onScreenText: LIMITS.maxCaptionChars,
  cta: LIMITS.maxCtaChars,
};

/** Fields that appear in the rendered video. Editing the others never makes an existing video outdated. */
export const RENDERED_FIELDS: readonly CopyField[] = ["hook", "openingLine", "onScreenText", "cta"];

export const fieldProblem = (value: string, max: number): boolean => !value.trim() || value.length > max;
export const conceptValid = (c: Concept): boolean => (Object.keys(FIELD_MAX) as CopyField[]).every((f) => !fieldProblem(c[f], FIELD_MAX[f]));
