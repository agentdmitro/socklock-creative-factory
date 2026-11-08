import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { CONCEPT_IDS, type ConceptId, type TemplateId } from "@/lib/types";

const ROOT = path.join(os.tmpdir(), "socklock-creative-factory");
const TTL_MS = 2 * 60 * 60 * 1000;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const TEMPLATE_IDS: readonly TemplateId[] = ["statement", "editorial", "spotlight"];

export const isJobId = (v: string): boolean => JOB_ID.test(v);
export const isTemplateId = (v: unknown): v is TemplateId =>
  typeof v === "string" && (TEMPLATE_IDS as readonly string[]).includes(v);

export const isConceptId = (v: unknown): v is ConceptId =>
  typeof v === "string" && (CONCEPT_IDS as readonly string[]).includes(v);
/** Output names are derived from the concept slot enum only (one file per concept, so renders never overwrite each other). */
export const outputName = (c: ConceptId) => `variant-${c}.mp4`;
export const isOutputName = (v: string) => CONCEPT_IDS.some((c) => outputName(c) === v);

export function jobDir(jobId: string): string {
  if (!isJobId(jobId)) throw new Error("Invalid job id.");
  return path.join(ROOT, jobId);
}
export const sourcePath = (jobId: string) => path.join(jobDir(jobId), "source.mp4");
export const outputPath = (jobId: string, name: string) => path.join(jobDir(jobId), "out", name);
export const workDir = (jobId: string, tag: string) => path.join(jobDir(jobId), "work", tag);

export async function createJob(): Promise<string> {
  await sweepExpired();
  const id = randomUUID();
  await mkdir(path.join(jobDir(id), "out"), { recursive: true });
  return id;
}

export async function removeJob(jobId: string): Promise<void> {
  await rm(jobDir(jobId), { recursive: true, force: true });
}

async function sweepExpired(): Promise<void> {
  await mkdir(ROOT, { recursive: true });
  const now = Date.now();
  for (const name of await readdir(ROOT)) {
    if (!isJobId(name)) continue;
    try {
      const s = await stat(path.join(ROOT, name));
      if (now - s.mtimeMs > TTL_MS) await rm(path.join(ROOT, name), { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}
