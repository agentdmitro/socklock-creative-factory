import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { HealthReport } from "@/lib/types";
import { fontPath } from "./text";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

export class ProcessError extends Error {
  constructor(message: string, readonly stderr: string) {
    super(message);
    this.name = "ProcessError";
  }
}

function versionOf(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(bin, ["-version"], { timeout: 8000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.split("\n")[0]?.trim() ?? null);
    });
  });
}

let healthCache: { at: number; value: Omit<HealthReport, "ai"> } | null = null;

/** `maxAgeMs` lets hot paths (uploads) reuse a recent healthy result instead of spawning two processes each time. */
export async function checkHealth(maxAgeMs = 0): Promise<Omit<HealthReport, "ai">> {
  if (maxAgeMs && healthCache?.value.ok && Date.now() - healthCache.at < maxAgeMs) return healthCache.value;
  const [ffmpeg, ffprobe] = await Promise.all([versionOf(FFMPEG), versionOf(FFPROBE)]);
  const font = fontPath();
  const problems: string[] = [];
  if (!ffmpeg) problems.push("FFmpeg was not found. Install it (macOS: brew install ffmpeg) or set FFMPEG_PATH.");
  if (!ffprobe) problems.push("ffprobe was not found. It ships with FFmpeg; install it or set FFPROBE_PATH.");
  if (font && !existsSync(font)) problems.push("Configured font file does not exist.");
  const value = { ok: problems.length === 0, ffmpeg, ffprobe, font, problems };
  healthCache = { at: Date.now(), value };
  return value;
}

/** Run a binary with an argument array (never through a shell). */
function run(bin: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stdout = "";
    let stderr = "";
    const cap = (s: string, chunk: Buffer) => (s + chunk.toString()).slice(-64_000);
    child.stdout.on("data", (c: Buffer) => (stdout = cap(stdout, c)));
    child.stderr.on("data", (c: Buffer) => (stderr = cap(stderr, c)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const msg = err.code === "ENOENT" ? `${bin} is not installed or not on PATH.` : err.message;
      reject(new ProcessError(msg, stderr));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const reason = signal ? `${bin} timed out or was killed.` : `${bin} exited with code ${code}.`;
      reject(new ProcessError(reason, stderr));
    });
  });
}

export const ffprobe = (args: string[]) => run(FFPROBE, args, 30_000);
export const ffmpeg = (args: string[]) => run(FFMPEG, args, 180_000);
