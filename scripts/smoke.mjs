// End-to-end demo + smoke test against a RUNNING server (dev or `npm start`).
//   npm run demo [-- path/to/source.mp4]        BASE_URL defaults to http://localhost:3000
//
// Drives the same HTTP API the UI uses:
//   generate 6 concepts (no video yet) -> approve / reject / edit -> pick 3 approved -> upload -> render (+1 deliberate failure)
//   -> preview (Range) -> accept/reject videos -> export -> metrics
// then verifies every output with ffprobe + a full decode, and asserts that the telemetry recorded by the server
// equals what this script actually did.
//
// The run is tagged origin "scripted": it proves the pipeline and the telemetry, but it is NOT a human timing, so it is
// listed under "Scripted demo runs" in Insights and never feeds human-time-per-accepted. Mock ideas only: it never
// calls a paid AI provider.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeSample } from "./make-sample.mjs";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cvf-demo-"));
const sid = randomUUID();
let source = process.argv[2];
if (!source) {
  console.log("Generating a synthetic 12 s sample source…");
  source = makeSample(path.join(dir, "sample.mp4"));
}
assert.ok(existsSync(source), `No such file: ${source}`);

const json = async (res) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${res.status}: ${body.error}`), { status: res.status });
  return body;
};
const post = (url, body) => fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
const events = (...list) => post("/api/events", { events: list.map((e) => ({ sid, ...e })) });
const step = (s) => console.log(`\n▸ ${s}`);

step("health");
const health = await fetch(base + "/api/health").then(json);
assert.ok(health.ok, `Setup problems: ${health.problems}`);

step("session started (scripted)");
await events({ type: "session_started", origin: "scripted" });
await assert.rejects(post("/api/events", { events: [{ sid: "not-a-uuid", type: "session_started", origin: "scripted" }] }), /No valid events/);

step("generate 6 concepts (Mock ideas, before any video exists)");
const fields = { script: "Our socks slip. Watch this runner fix it in seconds.", product: "SockLock — anti-slip sports socks that stay put", cta: "Shop now at socklock.com" };
const { brand, concepts, generation } = await post("/api/concepts", { ...fields, provider: "mock", count: 6, sessionId: sid });
assert.equal(concepts.length, 6);
assert.equal(generation.provider, "mock");
assert.equal(generation.count, 6);
assert.equal(new Set(concepts.map((c) => c.angle)).size, 6, "six different angles");
assert.equal(new Set(concepts.map((c) => c.hook)).size, 6, "six different hooks");
for (const c of concepts) for (const f of ["angle", "hook", "openingLine", "onScreenText", "cta", "rationale"]) assert.ok(c[f], `${c.id}.${f}`);
assert.equal((await post("/api/concepts", { ...fields, provider: "mock" })).concepts.length, 6, "default is 6");
assert.equal((await post("/api/concepts", { ...fields, provider: "mock", count: 3 })).concepts.length, 3);
await assert.rejects(post("/api/concepts", { ...fields, provider: "mock", count: 4 }), /3, 6 or 9/);

step("review: all start approved; reject 2, edit one");
await events({ type: "concept_rejected", variant: "c4" }, { type: "concept_rejected", variant: "c6" });
const edited = { ...concepts[0], hook: "Socks that finally stay put." };
const batch = [edited, concepts[1], concepts[2]]; // 4 approved, default batch of 3
await events({ type: "variant_edited", variant: "c1", fields: "hook", chars: 24 });

step("upload (only now, to render)");
const info = await fetch(base + "/api/source", { method: "POST", headers: { "x-file-name": "sample.mp4", "x-session-id": sid }, body: readFileSync(source) }).then(json);
console.log(`  ${info.durationSec}s ${info.width}x${info.height}`);

step("render the 3 selected concepts + 1 deliberately invalid request");
const outputs = [];
const renderMs = {};
for (const c of batch) {
  const t0 = Date.now();
  const r = await post("/api/render", { jobId: info.jobId, startSec: 1, endSec: 9, fit: "contain", cta: fields.cta, brand, concept: c, sessionId: sid });
  renderMs[c.id] = r.renderMs;
  const file = path.join(dir, r.file);
  writeFileSync(file, Buffer.from(await (await fetch(`${base}/api/jobs/${info.jobId}/output/${r.file}`)).arrayBuffer()));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt,nb_read_frames:format=duration,size", "-of", "json", file]).toString());
  const s = probe.streams[0];
  assert.equal(s.codec_name, "h264");
  assert.equal(`${s.width}x${s.height}`, "720x1280");
  assert.equal(s.pix_fmt, "yuv420p");
  assert.ok(Math.abs(Number(probe.format.duration) - 10) < 0.25, "duration ~10 s");
  execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"]); // full decode = playback smoke test
  console.log(`  ${r.file}: ${s.codec_name} ${s.width}x${s.height} ${s.r_frame_rate} ${s.nb_read_frames} frames ${Number(probe.format.duration).toFixed(2)}s, ${(Date.now() - t0) / 1000}s round trip, server render ${r.renderMs} ms`);
  outputs.push({ id: c.id, file });
}
await assert.rejects(post("/api/render", { jobId: info.jobId, startSec: 1, endSec: 2, fit: "contain", cta: fields.cta, brand, concept: batch[0], sessionId: sid }), /segment between/i);

step("preview: ranged playback request");
const ranged = await fetch(`${base}/api/jobs/${info.jobId}/output/variant-${batch[0].id}.mp4?v=1`, { headers: { Range: "bytes=0-1023" } });
assert.equal(ranged.status, 206);
assert.match(ranged.headers.get("content-range") ?? "", /^bytes 0-1023\/\d+$/);
await ranged.arrayBuffer();

step("accept 2, reject 1");
await events({ type: "variant_accepted", variant: batch[0].id }, { type: "variant_accepted", variant: batch[1].id }, { type: "variant_rejected", variant: batch[2].id });

step("export the 2 accepted (full download requests)");
for (const c of batch.slice(0, 2)) {
  const res = await fetch(`${base}/api/jobs/${info.jobId}/output/variant-${c.id}.mp4?v=1&download=1&sid=${sid}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment/);
  assert.ok((await res.arrayBuffer()).byteLength > 10_000);
}

step("finish session");
await events({ type: "session_time", activeMs: null, waitUploadMs: 0, waitAiMs: 0, waitRenderMs: 0 }, { type: "session_completed" });
await fetch(`${base}/api/jobs/${info.jobId}`, { method: "DELETE" });

step("inspect metrics and compare with what this script did");
const report = await fetch(`${base}/api/insights?scope=scripted`).then(json);
const row = report.rows.find((r) => r.sid === sid);
assert.ok(row, "session present in Insights");
const expected = { origin: "scripted", completed: true, activeSec: null, sources: 1, variationsGenerated: 6, aiRequests: 1, providers: "mock", estCostUsd: 0, rendersOk: 3, rendersFailed: 1, variantsEdited: 1, conceptsApproved: 4, conceptsRejected: 2, conceptsEdited: 1, editChars: 24, accepted: 2, rejected: 1, firstPassAccepted: 2, exported: 2 };
for (const [k, v] of Object.entries(expected)) assert.deepEqual(row[k], v, `${k}: telemetry ${JSON.stringify(row[k])} != observed ${JSON.stringify(v)}`);
const sumMs = Object.values(renderMs).reduce((a, b) => a + b, 0);
assert.ok(Math.abs(row.renderSec * 1000 - sumMs) < 400, `render time telemetry ${row.renderSec}s vs observed ${sumMs / 1000}s`);
const csv = await fetch(`${base}/api/insights/export?kind=sessions&scope=scripted`).then((r) => r.text());
assert.ok(csv.includes(sid), "sessions CSV contains the session");
assert.ok((await fetch(`${base}/api/insights?scope=interactive`).then(json)).rows.every((r) => r.sid !== sid), "scripted run must not leak into hands-on metrics");

console.table({
  "telemetry vs observed": { rendersOk: `${row.rendersOk} = 3`, rendersFailed: `${row.rendersFailed} = 1`, accepted: `${row.accepted} = 2`, rejected: `${row.rejected} = 1`, exported: `${row.exported} = 2`, edited: `${row.variantsEdited} = 1`, approved: `${row.conceptsApproved} = 4`, conceptsRejected: `${row.conceptsRejected} = 2`, renderSec: `${row.renderSec} ≈ ${(sumMs / 1000).toFixed(1)}` },
});
console.log(`\n✔ Demo and telemetry checks passed. Outputs in ${dir}`);
console.log(`  session ${sid} is listed under Insights → "Scripted demo runs".`);
