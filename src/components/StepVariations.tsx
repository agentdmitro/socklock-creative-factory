"use client";

import { FIELD_MAX, conceptValid, fieldProblem } from "@/lib/concepts";
import { COPY_FIELDS, MAX_RENDER_COUNT, type Concept, type ConceptId, type ConceptStatus, type CopyField, type GenerationReport, type TemplateId } from "@/lib/types";
import { AiMagicIcon, ArrowLeft01Icon, Film01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { GenerationLine } from "./AiBadge";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { TextArea, TextInput } from "./Field";
import shared from "./steps.module.scss";
import styles from "./StepVariations.module.scss";

interface Props {
  concepts: Concept[];
  suggested: Concept[];
  /** "approved" = this concept becomes a video. */
  status: Partial<Record<ConceptId, ConceptStatus>>;
  picked: ConceptId[];
  generation: GenerationReport | null;
  canRegenerate: boolean;
  regenerating: boolean;
  hasSource: boolean;
  renderLabel: string;
  onChange: (id: ConceptId, patch: Partial<Pick<Concept, CopyField>>) => void;
  onStatus: (id: ConceptId, status: ConceptStatus) => void;
  onRegenerate: () => void;
  onBack: () => void;
  onRender: () => void;
}

const SWATCH: Record<TemplateId, string> = { statement: "#14161A", editorial: "#E4572E", spotlight: "#2646E6" };

const LABEL: Record<CopyField, string> = {
  hook: "Hook (0–2 s, big text)",
  openingLine: "Opening line (0–2 s, under the hook)",
  onScreenText: "On-screen text (2–8 s)",
  cta: "Call to action (8–10 s)",
};
const EMPTY: Record<CopyField, string> = {
  hook: "The hook cannot be empty.",
  openingLine: "The opening line cannot be empty.",
  onScreenText: "The on-screen text cannot be empty.",
  cta: "The call to action cannot be empty.",
};
const TOO_LONG: Record<CopyField, string> = {
  hook: "Too long for the screen.",
  openingLine: "Too long: keep it to one sentence.",
  onScreenText: "Too long for the screen.",
  cta: "Too long for the button.",
};

export function StepVariations(p: Props) {
  const { concepts, picked } = p;
  const invalidPicked = concepts.some((c) => picked.includes(c.id) && !conceptValid(c));
  const ready = picked.length >= 1 && !invalidPicked;
  const hint = picked.length === 0
    ? "Switch on at least one concept to make a video."
    : invalidPicked
      ? "Fix the highlighted fields."
      : !p.hasSource
        ? "Add a source video to create the videos."
        : "";

  return (
    <>
      <div>
        <h2 className={shared.cardTitle} tabIndex={-1} data-step-heading>{concepts.length} creative concepts</h2>
        <p className={shared.cardSub}>Each one takes a different angle. Edit anything, and switch on “Make a video” for the ones you want (up to {MAX_RENDER_COUNT}).</p>
        {p.generation && <GenerationLine g={p.generation} />}
      </div>
      {p.generation?.fallback && <p className={shared.notice} role="status">{p.generation.fallback.message}</p>}
      {p.generation && p.generation.replaced.length > 0 && (
        <p className={shared.notice} role="status">
          {p.generation.replaced.length} of {concepts.length} AI concepts were rejected (unsupported claims, invalid copy or too similar to another concept) and replaced with offline ideas.
        </p>
      )}

      <div className={styles.list}>
        {concepts.map((c, i) => {
          const on = picked.includes(c.id);
          return (
            <ConceptCard
              key={c.id}
              index={i}
              concept={c}
              original={p.suggested.find((s) => s.id === c.id)}
              on={on}
              canSwitchOn={on || picked.length < MAX_RENDER_COUNT}
              onChange={(patch) => p.onChange(c.id, patch)}
              onToggle={() => p.onStatus(c.id, on ? "rejected" : "approved")}
            />
          );
        })}
      </div>

      <div className={shared.footer}>
        <div>
          <Button variant="ghost" icon={ArrowLeft01Icon} onClick={p.onBack}>Back</Button>
          {p.canRegenerate && <Button variant="ghost" icon={AiMagicIcon} loading={p.regenerating} onClick={p.onRegenerate}>Regenerate with AI</Button>}
        </div>
        <div className={shared.footerEnd}>
          <p className={styles.footerHint} role="status">{hint || `${picked.length} of ${concepts.length} will become videos`}</p>
          {p.hasSource ? (
            <Button variant="primary" icon={Film01Icon} disabled={!ready} onClick={p.onRender}>{p.renderLabel}</Button>
          ) : (
            <Button variant="primary" icon={ArrowLeft01Icon} onClick={p.onBack}>Add source video</Button>
          )}
        </div>
      </div>
    </>
  );
}

interface CardProps {
  index: number;
  concept: Concept;
  original: Concept | undefined;
  on: boolean;
  canSwitchOn: boolean;
  onChange: (patch: Partial<Pick<Concept, CopyField>>) => void;
  onToggle: () => void;
}

function ConceptCard({ index, concept: c, original, on, canSwitchOn, onChange, onToggle }: CardProps) {
  const valid = conceptValid(c);
  const edited = original ? COPY_FIELDS.some((f) => c[f] !== original[f]) : false;

  return (
    <section className={`${shared.card} ${styles.card} ${on ? "" : styles.rejected}`} aria-label={`Concept ${index + 1}: ${c.angle}`}>
      <div className={styles.head}>
        <span className={styles.swatch} style={{ background: SWATCH[c.template] }} aria-hidden="true" title="Video template" />
        <div className={styles.headText}>
          <h3 className={styles.name}>{index + 1}. {c.angle}</h3>
          {c.rationale && <p className={styles.why}>{c.rationale}</p>}
        </div>
        {on && !valid && <Badge tone="warn">Needs a fix</Badge>}
        <label className={`${styles.pick} ${!on && !canSwitchOn ? styles.pickOff : ""}`} title={!on && !canSwitchOn ? `At most ${MAX_RENDER_COUNT} videos. Switch another one off first.` : undefined}>
          <input type="checkbox" checked={on} disabled={!on && !canSwitchOn} onChange={onToggle} />
          Make a video
        </label>
      </div>

      <div className={styles.fields}>
        {COPY_FIELDS.map((f) => {
          const problem = fieldProblem(c[f], FIELD_MAX[f]);
          const common = {
            label: LABEL[f], value: c[f], onChange: (e: { target: { value: string } }) => onChange({ [f]: e.target.value }),
            counter: { value: c[f].length, max: FIELD_MAX[f] }, error: problem ? (c[f].trim() ? TOO_LONG[f] : EMPTY[f]) : "",
          };
          return f === "hook" || f === "openingLine" ? <TextArea key={f} rows={2} {...common} /> : <TextInput key={f} {...common} />;
        })}
      </div>

      {edited && original && (
        <div className={styles.actions}>
          <Button variant="ghost" icon={Refresh01Icon} onClick={() => onChange({ hook: original.hook, openingLine: original.openingLine, onScreenText: original.onScreenText, cta: original.cta })}>Reset</Button>
        </div>
      )}
    </section>
  );
}
