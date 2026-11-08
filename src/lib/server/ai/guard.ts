/**
 * Deterministic claim guard. The model is told to use only the provided facts; this checks that it did.
 * It flags offers, guarantees, superlatives, health/certification claims and numbers that do not appear in
 * the user's own text. It is a safety net, not a proof of truthfulness: users still review all copy.
 */

const RISKY: { name: string; re: RegExp }[] = [
  { name: "discount or price", re: /(?<![\p{L}])(discount|sale|coupon|promo(?:\s?code)?|cheap(?:est)?|bargain|знижк\w*|акці[яїйю]\w*|розпродаж\w*|скидк\w*)|[$€£₴]\s?\d|\d\s?(?:%|percent)|\bpercent\b/iu },
  { name: "free offer", re: /(?<![\p{L}])(free|complimentary|безкоштовн\w*|бесплатн\w*)/iu },
  { name: "guarantee or refund", re: /(?<![\p{L}])(guarantee\w*|warrant(?:y|ies)|money[- ]back|refund\w*|risk[- ]free|гаранті\w*|гарантир\w*|повернення\s+коштів)/iu },
  { name: "superlative or ranking", re: /(?<![\p{L}])(best|#\s?1|no\.?\s?1|number one|world'?s|unbeatable|perfect|найкращ\w*|лучш\w*|№\s?1)/iu },
  { name: "proof or certification", re: /(?<![\p{L}])(clinically|scientifically|proven|certified|approved|dermatolog\w*|doctor\w*|award[- ]winning|patented|лікар\w*|сертифікован\w*|доведен\w*)/iu },
  { name: "urgency or scarcity", re: /(?<![\p{L}])(limited[- ]time|today only|last chance|while (?:stocks|supplies) last|hurry|lifetime|forever|обмежен\w*|лише\s+сьогодні)/iu },
  { name: "absolute claim", re: /100\s?%|(?<![\p{L}])(never|always|instantly|zero|completely|totally)(?![\p{L}])/iu },
];

const NUM_RE = /\d+(?:[.,]\d+)?/g;

/** Returns the reasons the text makes claims that are not supported by `source`; empty when it is clean. */
export function unsupportedClaims(text: string, source: string): string[] {
  const reasons: string[] = [];
  for (const { name, re } of RISKY) {
    if (re.test(text) && !re.test(source)) reasons.push(name);
  }
  const known = new Set(source.match(NUM_RE) ?? []);
  const extra = (text.match(NUM_RE) ?? []).filter((n) => !known.has(n));
  if (extra.length) reasons.push(`numbers not in your facts (${extra.slice(0, 3).join(", ")})`);
  return reasons;
}
