import { LIMITS, type SourceInfo } from "@/lib/types";
import { ffprobe, ProcessError } from "./binaries";

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
}
interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { format_name?: string; duration?: string };
}

export class UnusableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableSourceError";
  }
}

function parseFps(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return 0;
  return n / d;
}

export async function probeSource(
  file: string,
  meta: { jobId: string; fileName: string; sizeBytes: number },
): Promise<SourceInfo> {
  let out: ProbeOutput;
  try {
    const raw = await ffprobe(["-v", "error", "-protocol_whitelist", "file", "-print_format", "json", "-show_streams", "-show_format", file]);
    out = JSON.parse(raw) as ProbeOutput;
  } catch (err) {
    if (err instanceof ProcessError && /ENOENT|not installed/.test(err.message)) throw err;
    throw new UnusableSourceError("This file could not be read as video. Try re-exporting it as an H.264 MP4.");
  }

  const format = out.format?.format_name ?? "";
  if (!/mp4|mov/.test(format)) {
    throw new UnusableSourceError("The file is not an MP4 container. Please upload an .mp4 video.");
  }
  const video = out.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video?.width || !video.height) {
    throw new UnusableSourceError("No video track was found in this file.");
  }
  const duration = Number(out.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new UnusableSourceError("The video has no readable duration.");
  }

  const rotation = Math.abs(video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? Number(video.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  const width = swap ? video.height : video.width;
  const height = swap ? video.width : video.height;

  if (duration < LIMITS.minSourceSec) {
    throw new UnusableSourceError(`The video is ${duration.toFixed(1)}s long. At least ${LIMITS.minSourceSec}s of footage is needed.`);
  }
  if (duration > LIMITS.maxSourceSec) {
    throw new UnusableSourceError(`The video is longer than ${LIMITS.maxSourceSec / 60} minutes. Trim it first.`);
  }
  if (Math.min(width, height) < LIMITS.minShortSidePx) {
    throw new UnusableSourceError(`The resolution ${width}×${height} is too low for a sharp 720×1280 result.`);
  }

  const warnings: string[] = [];
  if (Math.min(width, height) < 480) warnings.push("Low resolution: the demo may look soft.");
  if (duration < 6) warnings.push("Short source: the demo will play in slow motion.");

  return {
    jobId: meta.jobId,
    fileName: meta.fileName,
    durationSec: Math.round(duration * 100) / 100,
    width,
    height,
    fps: Math.round(parseFps(video.avg_frame_rate) * 100) / 100,
    hasAudio: out.streams?.some((s) => s.codec_type === "audio") ?? false,
    sizeBytes: meta.sizeBytes,
    warnings,
  };
}
