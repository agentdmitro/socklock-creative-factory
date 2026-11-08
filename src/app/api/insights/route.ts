import { NextResponse } from "next/server";
import { buildReport, SCOPES, type Scope } from "@/lib/analytics";
import { readEvents } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("scope");
  const scope: Scope = SCOPES.find((s) => s === raw) ?? "interactive";
  return NextResponse.json(buildReport(await readEvents(), scope), { headers: { "Cache-Control": "no-store" } });
}
