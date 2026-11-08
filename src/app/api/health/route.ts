import { NextResponse } from "next/server";
import { checkHealth } from "@/lib/server/binaries";
import { aiStatus } from "@/lib/server/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...(await checkHealth()), ai: aiStatus() });
}
