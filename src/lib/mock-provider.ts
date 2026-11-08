import { CONCEPT_IDS, DEFAULT_CONCEPT_COUNT, LIMITS, type Concept, type ConceptRequest, type TemplateId } from "./types";


function hash(input: string): number {
  let h = 2166136261;
  for (const ch of input) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const pick = <T,>(items: readonly T[], seed: number): T => items[seed % items.length] as T;

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[,.;:\-–—\s]+$/, "")}…`;
}

function sentenceCase(t: string): string {
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** Brand = text before the first separator in the product context, e.g. "SockLock — grippy socks" → "SockLock". */
export function deriveBrand(product: string): string {
  const head = product.split(/\s[-–—]\s|[:,.\n]/)[0]?.trim() ?? "";
  return clip(head || "SockLock", 28).replace(/…$/, "");
}

function deriveBenefit(product: string, brand: string): string {
  const rest = product.replace(brand, "").replace(/^[\s:,.\-–—]+/, "").trim();
  return clip(rest || "stays exactly where you put it", 40).replace(/[.…]+$/, "");
}

/**
 * The creative strategies, in the order they are used: asking for 3 gives the first three, 9 gives all nine.
 * Each is a different way into the ad (not a reworded copy of another), which is what the AI prompt asks for too.
 */
export const ANGLES = [
  { key: "pain", label: "Pain-first", brief: "open on the viewer's frustration or the problem the product solves" },
  { key: "demo", label: "Product-demo-first", brief: "open on the product visibly working; the footage is the proof" },
  { key: "benefit", label: "Benefit-first", brief: "open on the outcome or benefit the viewer gets" },
  { key: "curiosity", label: "Curiosity gap", brief: "withhold the payoff for a moment so the viewer keeps watching" },
  { key: "interrupt", label: "Pattern interrupt", brief: "break the scroll with a direct, attention-grabbing command" },
  { key: "question", label: "Direct question", brief: "ask the viewer a question that makes them reconsider what they use today" },
  { key: "pov", label: "POV moment", brief: "put the viewer inside the experience of using the product" },
  { key: "skeptic", label: "Skeptic-friendly", brief: "acknowledge doubt calmly and let the footage do the convincing" },
  { key: "plain", label: "Straight talk", brief: "a calm, no-hype opening that simply states what the product is for" },
] as const;
export type AngleKey = (typeof ANGLES)[number]["key"];

const TEMPLATES: readonly TemplateId[] = ["statement", "editorial", "spotlight"];
export const templateFor = (index: number): TemplateId => TEMPLATES[index % TEMPLATES.length]!;

export function normalizeCount(n: unknown): 3 | 6 | 9 {
  return n === 3 || n === 6 || n === 9 ? n : (DEFAULT_CONCEPT_COUNT as 6);
}

interface Copy {
  hook: string;
  openingLine: string;
  onScreenText: string;
  rationale: string;
}

/** Deterministic and offline. Also the fallback whenever an AI provider fails or violates the claim rules. No invented facts. */
export function generateConcepts(req: Pick<ConceptRequest, "script" | "product" | "cta" | "count">): Concept[] {
  const count = normalizeCount(req.count);
  const brand = deriveBrand(req.product);
  const benefit = deriveBenefit(req.product, brand);
  const seed = hash(`${req.script}|${req.product}|${req.cta}`);
  const at = (i: number, options: readonly string[]) => pick(options, seed >>> (i * 3));

  const copy: Record<AngleKey, Copy> = {
    pain: {
      hook: at(0, [`Still dealing with this every single day?`, `This is the part nobody warns you about.`, `You’ve been putting up with this for too long.`]),
      openingLine: `If this sounds familiar, there is a simpler way to deal with it.`,
      onScreenText: `Here’s the fix: ${brand}`,
      rationale: "Opens on the everyday frustration, then shows the product as the fix.",
    },
    demo: {
      hook: at(1, [`Watch ${brand} in action.`, `See how ${brand} works.`, `${brand}, up close.`]),
      openingLine: `This is ${brand}, shown the way you would actually use it.`,
      onScreenText: `${brand} in use`,
      rationale: "Leads with the product working on screen and lets the footage make the case.",
    },
    benefit: {
      hook: at(2, [`${sentenceCase(benefit)}.`, `${brand}: ${benefit}.`, `Meet ${brand}: ${benefit}.`]),
      openingLine: `Here is what ${brand} gives you: ${benefit}.`,
      onScreenText: `That’s ${brand}`,
      rationale: "Leads with the outcome the viewer gets, then backs it with the demo.",
    },
    curiosity: {
      hook: at(3, [`Watch what happens next.`, `Keep your eyes on this part.`, `This is the part worth watching.`]),
      openingLine: `Stay with me for a few seconds, because the answer is on screen.`,
      onScreenText: `Look closely`,
      rationale: "Holds back the payoff just long enough to keep people watching, then the demo delivers it.",
    },
    interrupt: {
      hook: at(4, [`Stop scrolling for two seconds.`, `Hold on, look at this.`, `Pause here before you scroll on.`]),
      openingLine: `Give me a moment to show you ${brand}.`,
      onScreenText: `Meet ${brand}`,
      rationale: "A direct command breaks the scroll pattern before the product appears.",
    },
    question: {
      hook: at(5, [`Why put up with the old way?`, `Is your current one doing this?`, `Ever wished there was a simpler option?`]),
      openingLine: `Here is a simple answer to that question: ${brand}.`,
      onScreenText: `${brand}, explained simply`,
      rationale: "A question invites the viewer to compare with what they use now, then answers it.",
    },
    pov: {
      hook: at(6, [`POV: you finally try ${brand}.`, `POV: you gave ${brand} a go.`, `POV: your first day with ${brand}.`]),
      openingLine: `This is what it feels like to use ${brand}.`,
      onScreenText: `Using ${brand}`,
      rationale: "A first-person frame lets the viewer imagine the experience instead of being told about it.",
    },
    skeptic: {
      hook: at(7, [`Not convinced yet? Fair. Watch this.`, `Doubtful? Good. Look closer.`, `Skeptical is fine. See it for yourself.`]),
      openingLine: `You do not have to take my word for it, so here is ${brand} on camera.`,
      onScreenText: `See it for yourself`,
      rationale: "Meets doubt head-on and lets the footage do the convincing.",
    },
    plain: {
      hook: at(8, [`One product. One job.`, `A simple idea, clearly shown.`, `No fuss. Just ${brand}.`]),
      openingLine: `${brand} does one thing, and this is it.`,
      onScreenText: `${brand}, plain and simple`,
      rationale: "A calm, no-frills opening for an audience tired of hype.",
    },
  };

  return ANGLES.slice(0, count).map((a, i): Concept => {
    const c = copy[a.key];
    return {
      id: CONCEPT_IDS[i]!,
      template: templateFor(i),
      angle: a.label,
      hook: clip(c.hook, LIMITS.maxHookChars),
      openingLine: clip(c.openingLine, LIMITS.maxOpeningChars),
      onScreenText: clip(c.onScreenText, LIMITS.maxCaptionChars),
      cta: clip(req.cta, LIMITS.maxCtaChars),
      rationale: c.rationale,
    };
  });
}
