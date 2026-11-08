// Generates a synthetic demo source video locally with FFmpeg. No third-party footage or assets are involved:
// an animated gradient with a moving test card, plus a sine tone (which the product mutes anyway).
// Usage: npm run demo:media [-- output.mp4]      (default: demo/sample-source.mp4)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function makeSample(out = path.join("demo", "sample-source.mp4"), seconds = 12) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `gradients=size=1280x720:rate=30:duration=${seconds}:speed=0.03:seed=7`,
    "-f", "lavfi", "-i", `testsrc2=size=360x360:rate=30:duration=${seconds}`,
    "-f", "lavfi", "-i", `sine=frequency=330:duration=${seconds}`,
    "-filter_complex", "[0:v][1:v]overlay=x='(W-w)/2+300*sin(t)':y='(H-h)/2+110*cos(1.7*t)',format=yuv420p[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out,
  ]);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = makeSample(process.argv[2]);
  console.log(`Wrote ${out} (12 s, 1280x720). Upload it in the app, or run: npm run demo -- ${out}`);
}
