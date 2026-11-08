import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { LIMITS, OUTPUT, type RenderRequest, type RenderResult } from "@/lib/types";
import { ffmpeg, ffprobe, ProcessError } from "./binaries";
import { ctaCard, DEMO_WINDOW, demoBackdrop, hookCard } from "./cards";
import { isJobId, isStateless, outputName, outputPath, sourcePath, workDir } from "./jobs";
import { probeSource } from "./probe";

const probed = new Map<string, number>();

export class RenderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RenderInputError";
  }
}

/** Where in the chosen segment each template takes its hook still frame (fraction of segment). */
const STILL_AT = { statement: 0, editorial: 0.3, spotlight: 0.7 } as const;

function validate(req: RenderRequest): void {
  if (!isJobId(req.jobId)) throw new RenderInputError("Unknown job. Upload the source video again.");
  const { startSec, endSec } = req;
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
    throw new RenderInputError("The selected segment is invalid.");
  }
  const len = endSec - startSec;
  if (len < LIMITS.minSegmentSec || len > LIMITS.maxSegmentSec) {
    throw new RenderInputError(`Choose a segment between ${LIMITS.minSegmentSec} and ${LIMITS.maxSegmentSec} seconds.`);
  }
  const { hook, onScreenText: caption, openingLine } = req.concept;
  if (openingLine.length > LIMITS.maxOpeningChars) throw new RenderInputError(`Opening line must be at most ${LIMITS.maxOpeningChars} characters.`);
  if (!hook.trim() || hook.length > LIMITS.maxHookChars) throw new RenderInputError(`Hook text must be 1–${LIMITS.maxHookChars} characters.`);
  if (!caption.trim() || caption.length > LIMITS.maxCaptionChars) throw new RenderInputError(`On-screen text must be 1–${LIMITS.maxCaptionChars} characters.`);
  if (!req.cta.trim() || req.cta.length > LIMITS.maxCtaChars) throw new RenderInputError(`CTA must be 1–${LIMITS.maxCtaChars} characters.`);
  if (req.brand.length > 60) throw new RenderInputError("Brand name is too long.");
}

export async function renderVariant(req: RenderRequest): Promise<Omit<RenderResult, "renderMs">> {
  validate(req);
  const source = sourcePath(req.jobId);
  const gone = () => new RenderInputError("The source video is no longer available. Upload it again.");
  const size = await stat(source).then((s) => s.size).catch(() => {
    throw gone();
  });
  // The source never changes after upload, so probe it once per job instead of once per render.
  const probeKey = `${req.jobId}:${size}`;
  let duration = probed.get(probeKey);
  if (duration === undefined) {
    duration = (await probeSource(source, { jobId: req.jobId, fileName: "source.mp4", sizeBytes: size }).catch(() => {
      throw gone();
    })).durationSec;
    if (probed.size >= 50) probed.delete(probed.keys().next().value as string);
    probed.set(probeKey, duration);
  }
  if (req.endSec > duration + 0.05) throw new RenderInputError("The segment ends after the video does.");

  const t = req.concept.template;
  const slot = req.concept.id;
  const len = req.endSec - req.startSec;
  const dir = path.join(workDir(req.jobId, `${slot}-${randomBytes(4).toString("hex")}`));
  const out = outputPath(req.jobId, outputName(slot));
  const tmpOut = path.join(dir, "result.mp4");

  try {
    await mkdir(dir, { recursive: true });
    const still = path.join(dir, "still.png");
    const stillAt = req.startSec + len * STILL_AT[t];
    await ffmpeg([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-protocol_whitelist", "file", "-ss", stillAt.toFixed(3), "-i", source,
      "-frames:v", "1",
      "-vf", "scale=w=1280:h=1280:force_original_aspect_ratio=decrease",
      still,
    ]);

    const hookPng = path.join(dir, "hook.png");
    const demoPng = path.join(dir, "demo.png");
    const ctaPng = path.join(dir, "cta.png");
    await writeFile(hookPng, await hookCard(t, req.concept.hook, req.concept.openingLine.trim(), still, req.fit));
    await writeFile(demoPng, demoBackdrop(t, req.concept.onScreenText));
    await writeFile(ctaPng, ctaCard(t, req.brand || "SockLock", req.cta));

    const { width: W, height: H, fps, hookSec, demoSec, ctaSec } = OUTPUT;
    const total = hookSec + demoSec + ctaSec;
    const fitFilter =
      req.fit === "cover"
        ? `scale=${W}:${DEMO_WINDOW.h}:force_original_aspect_ratio=increase,crop=${W}:${DEMO_WINDOW.h}`
        : `scale=${W}:${DEMO_WINDOW.h}:force_original_aspect_ratio=decrease:force_divisible_by=2`;
    const base = `fps=${fps},setsar=1,format=yuv420p`;
    const graph = [
      `[0:v]${base}[hook]`,
      `[3:v]setpts=(PTS-STARTPTS)*${(demoSec / len).toFixed(6)},fps=${fps},${fitFilter},setsar=1[clip]`,
      `[1:v]${base}[bg]`,
      `[bg][clip]overlay=x=(W-w)/2:y=${DEMO_WINDOW.y}+(${DEMO_WINDOW.h}-h)/2:eof_action=pass,format=yuv420p[demo]`,
      `[2:v]${base}[cta]`,
      `[hook][demo][cta]concat=n=3:v=1:a=0[vout]`,
    ].join(";");
    const still_ = (png: string, sec: number) => ["-loop", "1", "-framerate", String(fps), "-t", String(sec), "-i", png];

    await ffmpeg([
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      ...still_(hookPng, hookSec),
      ...still_(demoPng, demoSec),
      ...still_(ctaPng, ctaSec),
      "-protocol_whitelist", "file", "-ss", req.startSec.toFixed(3), "-t", len.toFixed(3), "-i", source,
      "-f", "lavfi", "-t", String(total), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-filter_complex", graph,
      "-map", "[vout]", "-map", "4:a",
      "-t", String(total),
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-profile:v", "high",
      // Serverless responses are capped at ~4.5 MB: keep a 10 s clip safely under it.
      ...(isStateless() ? ["-maxrate", "2500k", "-bufsize", "5000k"] : []),
      "-c:a", "aac", "-b:a", "64k",
      "-movflags", "+faststart",
      tmpOut,
    ]);

    await verifyOutput(tmpOut);
    await rename(tmpOut, out);
    const size = (await stat(out)).size;
    return { file: outputName(slot), durationSec: total, width: W, height: H, sizeBytes: size };
  } catch (err) {
    if (err instanceof ProcessError) {
      const tail = err.stderr.trim().split("\n").slice(-2).join(" ").slice(0, 240);
      throw new RenderInputError(`Rendering failed. ${tail || err.message}`);
    }
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifyOutput(file: string): Promise<void> {
  const raw = await ffprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", file]);
  const parsed = JSON.parse(raw) as { streams?: { codec_name?: string; width?: number; height?: number }[]; format?: { duration?: string } };
  const s = parsed.streams?.[0];
  const dur = Number(parsed.format?.duration);
  if (s?.codec_name !== "h264" || s.width !== OUTPUT.width || s.height !== OUTPUT.height || Math.abs(dur - 10) > 0.25) {
    throw new RenderInputError("The rendered file failed verification. Please try again.");
  }
}
