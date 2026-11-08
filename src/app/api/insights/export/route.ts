import { buildReport, eventsCsv, eventsInScope, SCOPES, sessionsCsv, type Scope } from "@/lib/analytics";
import { readEvents } from "@/lib/server/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/insights/export?kind=sessions|events&scope=interactive|scripted|all */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const scope: Scope = SCOPES.find((s) => s === q.get("scope")) ?? "interactive";
  const kind = q.get("kind") === "events" ? "events" : "sessions";
  const events = await readEvents();
  const body = kind === "events" ? eventsCsv(eventsInScope(events, scope)) : sessionsCsv(buildReport(events, scope));
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cvf-${kind}-${scope}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
