// Verifies that GEMINI_MODEL exists for your key WITHOUT generating anything (models.get is metadata only: no tokens, no cost).
// Usage: npm run ai:check     (reads .env.local / .env if present, or the environment)
import { existsSync, readFileSync } from "node:fs";

for (const f of [".env.local", ".env"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
if (!key) {
  console.log("GEMINI_API_KEY is not set: the app runs in Mock mode. Nothing to check.");
  process.exit(0);
}
const { GoogleGenAI } = await import("@google/genai");
try {
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 10_000, retryOptions: { attempts: 1 }, baseUrl: process.env.GEMINI_BASE_URL || undefined } });
  const m = await ai.models.get({ model });
  const ok = !m.supportedActions || m.supportedActions.includes("generateContent");
  console.log(`${model}: available${ok ? ", supports generateContent" : ", but does NOT support generateContent"} (limits: in ${m.inputTokenLimit ?? "?"} / out ${m.outputTokenLimit ?? "?"})`);
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(`${model}: not available (${err?.status ?? "network error"}). Check GEMINI_MODEL and the key's access.`);
  process.exit(1);
}
