import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { HealthReport } from "@/lib/types";
import ffmpegStatic from "ffmpeg-static";
import { path as ffprobeStatic } from "@ffprobe-installer/ffprobe";
import { fontPath } from "./text";

/**
 * Which binary to run: FFMPEG_PATH / FFPROBE_PATH if set, else the one on PATH, else the copy bundled through npm
 * (ffmpeg-static, @ffprobe-installer). The bundled copy is what makes hosts without a system FFmpeg (e.g. Vercel) work.
 */
const resolved = new Map<string, Promise<string>>();
function resolveBin(name: "ffmpeg" | "ffprobe", envVar: string, bundled: string | null | undefined): Promise<string> {
  const explicit = process.env[envVar]?.trim();
  if (explicit) return Promise.resolve(explicit);
  let hit = resolved.get(name);
  if (!hit) {
    const fallback = bundled && existsSync(bundled) ? bundled : name;
    hit = (process.env.VERCEL ? Promise.resolve(null) : versionOf(name)).then((v) => (v ? name : fallback));
    resolved.set(name, hit);
  }
  return hit;
}
const FFMPEG = () => resolveBin("ffmpeg", "FFMPEG_PATH", ffmpegStatic);
const FFPROBE = () => resolveBin("ffprobe", "FFPROBE_PATH", ffprobeStatic);

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
  const [ffmpeg, ffprobe] = await Promise.all([FFMPEG().then(versionOf), FFPROBE().then(versionOf)]);
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

export const ffprobe = async (args: string[]) => run(await FFPROBE(), args, 30_000);
export const ffmpeg = async (args: string[]) => run(await FFMPEG(), args, 180_000);
