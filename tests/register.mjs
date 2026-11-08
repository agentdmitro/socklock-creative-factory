// Lets the unit tests import TypeScript source as-is: resolves the "@/" alias and extension-less relative imports.
// Test-only, no dependencies. Used via: node --import ./tests/register.mjs --test
import { register } from "node:module";

register("data:text/javascript," + encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = ${JSON.stringify(new URL("../src/", import.meta.url).href)};
const tryTs = (url) => {
  for (const candidate of [url + ".ts", url + "/index.ts"]) if (existsSync(fileURLToPath(candidate))) return candidate;
  return null;
};
export async function resolve(specifier, context, next) {
  let url = null;
  if (specifier.startsWith("@/")) url = new URL(specifier.slice(2), root).href;
  else if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier) && context.parentURL) url = new URL(specifier, context.parentURL).href;
  const hit = url && tryTs(url);
  return hit ? { url: hit, shortCircuit: true } : next(specifier, context);
}
`), import.meta.url);
