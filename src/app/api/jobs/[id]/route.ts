import { NextResponse } from "next/server";
import { fail, forbidden, sameOrigin } from "@/lib/server/http";
import { isJobId, removeJob } from "@/lib/server/jobs";

export const runtime = "nodejs";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(_req)) return forbidden();
  const { id } = await ctx.params;
  if (!isJobId(id)) return fail("Invalid job.", 400);
  await removeJob(id);
  return NextResponse.json({ ok: true });
}
