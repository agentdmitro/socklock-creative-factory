import { NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ApiError } from "@/lib/types";

export const fail = (error: string, status = 400) => NextResponse.json<ApiError>({ error }, { status });

export const tooMany = () => fail("Too many requests. Please wait a moment and try again.", 429);

/**
 * CSRF guard for state-changing requests: another website must not be able to make the user's browser call this
 * local API. A browser always sends Origin (or Sec-Fetch-Site) on cross-site writes; scripts and curl send neither.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

export const forbidden = () => fail("Cross-site request blocked.", 403);

const MAX_JSON_BYTES = 64 * 1024;

/** Reads a small JSON body. Anything larger than 64 KB is refused before it is parsed. */
export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_JSON_BYTES) return null;
    const text = await req.text();
    if (text.length > MAX_JSON_BYTES) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Serves an MP4 with HTTP Range support so <video> can seek. */
export async function serveVideo(req: Request, file: string, downloadName?: string): Promise<Response> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return fail("File not found.", 404);
  }
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (downloadName) headers["Content-Disposition"] = `attachment; filename="${downloadName}"`;

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : size - 1;
    if (Number.isNaN(start)) {
      start = Math.max(0, size - end);
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(size) } });
}
