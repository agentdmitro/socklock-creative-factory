import { generateConcepts } from "@/lib/mock-provider";
import { ANGLE_KEYS } from "./validate";
import type { IdeationInput, IdeationProvider, ProviderOutput } from "./provider";

/** Always available. Emits the same wire format as the AI provider so both go through one pipeline. */
export class MockProvider implements IdeationProvider {
  readonly id = "mock" as const;
  readonly model = null;

  async generate(input: IdeationInput): Promise<ProviderOutput> {
    const concepts = generateConcepts(input).map((c, i) => ({
      angle: ANGLE_KEYS[i], hook: c.hook, openingLine: c.openingLine, onScreenText: c.onScreenText, cta: c.cta, rationale: c.rationale,
    }));
    return { json: JSON.stringify({ concepts }), usage: null };
  }
}
