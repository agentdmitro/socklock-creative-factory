import { NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { checkHealth } from "@/lib/server/binaries";
import { isSessionId, recordEvents } from "@/lib/server/analytics";
import { fail, forbidden, sameOrigin, tooMany } from "@/lib/server/http";
import { rateLimit } from "@/lib/server/limits";
import { createJob, removeJob, sourcePath } from "@/lib/server/jobs";
import { probeSource, UnusableSourceError } from "@/lib/server/probe";
import { LIMITS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

class TooLargeError extends Error {}

/** Raw-body upload (not multipart) so the size limit is enforced while streaming to disk. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return forbidden();
  if (!rateLimit("source", 20, 60_000)) return tooMany();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.maxUploadBytes) return fail(`The file is larger than ${LIMITS.maxUploadBytes / 1024 / 1024} MB.`, 413);
  if (!req.body) return fail("No file received.");

  const health = await checkHealth(30_000);
  if (!health.ok) return fail(health.problems.join(" "), 503);

  const rawName = req.headers.get("x-file-name");
  let decoded = "source.mp4";
  try {
    if (rawName) decoded = decodeURIComponent(rawName);
  } catch {
    /* malformed header: fall back to a neutral name */
  }
  const fileName = decoded.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 80);

  const jobId = await createJob();
  const target = sourcePath(jobId);
  try {
    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > LIMITS.maxUploadBytes) return cb(new TooLargeError());
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), limiter, createWriteStream(target));

    const size = (await stat(target)).size;
    if (size === 0) throw new UnusableSourceError("The uploaded file is empty.");
    const fh = await open(target, "r");
    const head = Buffer.alloc(12);
    await fh.read(head, 0, 12, 0);
    await fh.close();
    if (head.subarray(4, 8).toString("latin1") !== "ftyp") {
      throw new UnusableSourceError("This does not look like an MP4 file. Please upload an .mp4 video.");
    }
    const info = await probeSource(target, { jobId, fileName, sizeBytes: size });
    const sid = req.headers.get("x-session-id");
    if (isSessionId(sid)) {
      void recordEvents([{ sid, type: "source_uploaded", durationSec: Math.round(info.durationSec * 10) / 10, width: info.width, height: info.height, sizeBytes: info.sizeBytes }]);
    }
    return NextResponse.json(info);
  } catch (err) {
    await removeJob(jobId);
    if (err instanceof TooLargeError) return fail(`The file is larger than ${LIMITS.maxUploadBytes / 1024 / 1024} MB.`, 413);
    if (err instanceof UnusableSourceError) return fail(err.message, 422);
    return fail("The upload failed. Check your connection and try again.", 500);
  }
}
