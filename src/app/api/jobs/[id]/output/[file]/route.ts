import { isSessionId, recordEvents } from "@/lib/server/analytics";
import { fail, serveVideo } from "@/lib/server/http";
import { isJobId, isOutputName, outputPath } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  if (!isJobId(id) || !isOutputName(file)) return fail("Not found.", 404);
  const q = new URL(req.url).searchParams;
  const download = q.has("download");
  const sid = q.get("sid");
  const res = await serveVideo(req, outputPath(id, file), download ? `socklock-${file}` : undefined);
  // An export is a download the server actually served in full (previews use Range requests and never count).
  if (download && res.status === 200 && isSessionId(sid)) {
    const variant = file.replace(/^variant-/, "").replace(/\.mp4$/, "");
    void recordEvents([{ sid, type: "variant_exported", variant, sizeBytes: Number(res.headers.get("Content-Length") ?? 0) }]);
  }
  return res;
}
