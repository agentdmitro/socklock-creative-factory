import { fail, serveVideo } from "@/lib/server/http";
import { isJobId, sourcePath } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isJobId(id)) return fail("Invalid job.", 400);
  return serveVideo(req, sourcePath(id));
}
