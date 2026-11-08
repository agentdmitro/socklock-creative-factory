"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deleteJob, getConcepts, getHealth, renderInline, renderVariant, uploadSource } from "@/lib/client";
import { useSessionTracker } from "@/lib/telemetry";
import { RENDERED_FIELDS, editSize, initialStatus, selectedConcepts } from "@/lib/concepts";
import { COPY_FIELDS, DEFAULT_CONCEPT_COUNT, DEFAULT_RENDER_COUNT, LIMITS, type Concept, type ConceptId, type ConceptStatus, type CopyField, type FitMode, type GenerationReport, type HealthReport, type ProviderId, type RenderResult, type SourceInfo } from "@/lib/types";
import { Analytics01Icon, ArrowLeft01Icon, Film01Icon, Refresh01Icon, RefreshIcon } from "@hugeicons/core-free-icons";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { AiBadge } from "./AiBadge";
import { Insights } from "./Insights";
import { Stepper } from "./Stepper";
import { useToast } from "./Toast";
import { StepSource, type SourceFields } from "./StepSource";
import { StepVariations } from "./StepVariations";
import { StepDone, type DoneState } from "./StepDone";
import { StepReview, type Decision, type RenderState } from "./StepReview";
import styles from "./Factory.module.scss";

const EMPTY_FIELDS: SourceFields = { script: "", product: "", cta: "" };
const OFFLINE: HealthReport = { ok: false, ffmpeg: null, ffprobe: null, font: null, problems: ["Cannot reach the local server. Is `npm run dev` still running?"], stateless: false, ai: { defaultProvider: "mock", gemini: { configured: false, model: "" } } };

function subscribeHash(notify: () => void) {
  window.addEventListener("hashchange", notify);
  window.addEventListener("popstate", notify);
  return () => {
    window.removeEventListener("hashchange", notify);
    window.removeEventListener("popstate", notify);
  };
}

export function Factory() {
  const toast = useToast();
  const tracker = useSessionTracker();
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<SourceInfo | null>(null);
  // The chosen file stays in the browser: on stateless hosts it is sent with every render and previewed from a blob URL.
  const sourceFile = useRef<File | null>(null);
  const [localSourceUrl, setLocalSourceUrl] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ active: boolean; pct: number }>({ active: false, pct: 0 });
  const [fields, setFields] = useState<SourceFields>(EMPTY_FIELDS);
  const [range, setRange] = useState({ start: 0, end: 8 });
  const [fit, setFit] = useState<FitMode>("contain");
  const [brand, setBrand] = useState("SockLock");
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [suggested, setSuggested] = useState<Concept[]>([]);
  const [count, setCount] = useState<number>(DEFAULT_CONCEPT_COUNT);
  const [status, setStatus] = useState<Partial<Record<ConceptId, ConceptStatus>>>({});
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [renders, setRenders] = useState<Partial<Record<ConceptId, RenderState>>>({});
  const [decisions, setDecisions] = useState<Partial<Record<ConceptId, Decision>>>({});
  const [reasons, setReasons] = useState<Partial<Record<ConceptId, string>>>({});
  const [done, setDone] = useState<DoneState | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const rendering = useRef(false);
  const generating = useRef(false);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [generation, setGeneration] = useState<GenerationReport | null>(null);
  // Inputs the current concepts were generated from. Same inputs + same provider => never call the API again.
  const [generatedKey, setGeneratedKey] = useState("");
  const bodyRef = useRef<HTMLDivElement>(null);

  const loadHealth = useCallback(() => {
    getHealth()
      .then((h) => {
        setHealth(h);
        setProvider((p) => p ?? h.ai.defaultProvider);
      })
      .catch(() => {
        setHealth(OFFLINE);
        setProvider((p) => p ?? "mock");
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(loadHealth, [loadHealth]);
  const recheck = () => {
    setChecking(true);
    loadHealth();
  };

  // Insights lives behind #insights so it survives a reload and the browser Back button works.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const view = hash === "#insights" ? "insights" : "factory";
  const showInsights = useCallback(() => {
    window.location.hash = "insights";
  }, []);
  const showFactory = useCallback(() => {
    window.history.pushState(null, "", window.location.pathname);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);
  useEffect(() => {
    // Reading reports is not production work: stop the hands-on clock while Insights is open.
    if (view === "insights") tracker.pause();
    else tracker.resume();
  }, [view, tracker]);

  // Idea work and video work are timed separately: the hands-on clock follows the step.
  useEffect(() => {
    tracker.setPhase(step >= 2 ? "video" : "ideation");
  }, [step, tracker]);

  // Move keyboard focus to the new step's heading so screen-reader and keyboard users land on the new content.
  const shown = useRef({ step, view });
  useEffect(() => {
    if (shown.current.step === step && shown.current.view === view) return;
    shown.current = { step, view };
    bodyRef.current?.querySelector<HTMLElement>("[data-step-heading]")?.focus();
  }, [step, view]);

  const keys = useMemo(() => {
    const out = {} as Record<ConceptId, string>;
    for (const c of concepts) out[c.id] = JSON.stringify([source?.jobId, c.template, c.hook, c.openingLine, c.onScreenText, c.cta, range.start, range.end, fit, brand]);
    return out;
  }, [concepts, source?.jobId, range, fit, brand]);

  const isStale = (id: ConceptId) => {
    const r = renders[id];
    return r?.status === "done" && r.key !== keys[id];
  };

  const renderedIds = () => (Object.keys(renders) as ConceptId[]).filter((id) => renders[id]?.status === "done");

  /** The video no longer matches what was approved: log the edit and withdraw any decision. */
  const invalidate = (ids: ConceptId[], field: string, chars = 0) => {
    if (!ids.length) return;
    for (const id of ids) tracker.noteEdit(id, field, chars);
    setDecisions((d) => {
      const next = { ...d };
      for (const id of ids) delete next[id];
      return next;
    });
  };

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.mp4$/i.test(file.name) && file.type !== "video/mp4") return toast("Please choose an .mp4 video.", "error");
      if (file.size > LIMITS.maxUploadBytes) return toast(`That file is over ${LIMITS.maxUploadBytes / 1024 / 1024} MB.`, "error");
      const sid = tracker.begin();
      setUpload({ active: true, pct: 0 });
      tracker.startWait("upload");
      try {
        const info = await uploadSource(file, (pct) => setUpload({ active: true, pct }), sid);
        if (source) {
          invalidate(renderedIds(), "source");
          void deleteJob(source.jobId);
        }
        sourceFile.current = file;
        if (health?.stateless) setLocalSourceUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(file);
        });
        setSource(info);
        setRange({ start: 0, end: Math.min(info.durationSec, 8) });
        setRenders({});
        setDecisions({});
        toast("Source video ready.", "success");
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed.", "error");
      } finally {
        tracker.endWait("upload");
        setUpload({ active: false, pct: 0 });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, toast, tracker, renders, health],
  );

  const activeProvider: ProviderId = provider ?? "mock";

  const reviewedAny = concepts.length > 0 && (concepts.some((c, i) => status[c.id] !== (i < DEFAULT_RENDER_COUNT ? "approved" : "rejected")) || concepts.some((c, i) => COPY_FIELDS.some((f) => suggested[i] && c[f] !== suggested[i][f])));
  const briefKey = JSON.stringify([fields.script.trim(), fields.product.trim(), fields.cta.trim(), activeProvider, count]);
  const briefUnchanged = concepts.length === count && generatedKey === briefKey;

  /** The only place an AI request is started, and only from an explicit click. */
  const generate = async (force: boolean) => {
    if (generating.current) return;
    const req = { script: fields.script.trim(), product: fields.product.trim(), cta: fields.cta.trim(), provider: activeProvider, count };
    if (!force && briefUnchanged) {
      setStep(1); // nothing changed: keep the concepts, the user's edits and decisions, spend nothing
      return;
    }
    if (!force && reviewedAny && !window.confirm("New concepts replace your current ones, including edits and approvals. Continue?")) return;
    generating.current = true;
    setLoadingConcepts(true);
    const sid = tracker.begin();
    tracker.startWait("ai");
    try {
      const res = await getConcepts({ ...req, force, sessionId: sid });
      setGeneratedKey(briefKey);
      setBrand(res.brand);
      setSuggested(res.concepts);
      setConcepts(res.concepts);
      setGeneration(res.generation);
      // The first three concepts start selected for video; switch on any others you want.
      const initial = initialStatus(res.concepts, DEFAULT_RENDER_COUNT);
      setStatus(initial);
      for (const c of res.concepts) if (initial[c.id] === "rejected") tracker.track("concept_rejected", c.id);
      setRenders({});
      setDecisions({});
      setStep(1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not create concepts.", "error");
    } finally {
      tracker.endWait("ai");
      generating.current = false;
      setLoadingConcepts(false);
    }
  };

  const regenerate = () => {
    if (reviewedAny && !window.confirm("Regenerating replaces your edits and approvals and makes a new AI request. Continue?")) return;
    void generate(true);
  };

  /** Switch a concept on or off for video. Off is recorded as rejected, on as approved. */
  const setConceptStatus = (id: ConceptId, next: ConceptStatus) => {
    if ((status[id] ?? "rejected") === next) return;
    setStatus({ ...status, [id]: next });
    tracker.track(next === "approved" ? "concept_approved" : "concept_rejected", id);
  };

  const updateConcept = (id: ConceptId, patch: Partial<Pick<Concept, CopyField>>) => {
    const current = concepts.find((c) => c.id === id);
    if (!current) return;
    const changed = COPY_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== current[f]);
    if (!changed.length) return;
    const chars = changed.reduce((n, f) => n + editSize(current[f], patch[f] as string), 0);
    tracker.addChars(chars);
    tracker.noteEdit(id, changed.join(","), chars);
    // Only the fields that appear in the video can make an existing video (and its decision) outdated.
    if (changed.some((f) => RENDERED_FIELDS.includes(f))) {
      setDecisions((d) => {
        const next = { ...d };
        delete next[id];
        return next;
      });
    }
    setConcepts((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const pendingRender = (): ConceptId[] =>
    concepts.filter((c) => {
      if (!picked.includes(c.id)) return false;
      const r = renders[c.id];
      return !r || r.status === "error" || (r.status === "done" && r.key !== keys[c.id]);
    }).map((c) => c.id);

  const runRenders = async (ids: ConceptId[]) => {
    if (!source || rendering.current || !ids.length) return;
    rendering.current = true;
    setIsRendering(true);
    tracker.flushEdits();
    setStep(2);
    setDecisions((d) => {
      const next = { ...d };
      for (const id of ids) delete next[id];
      return next;
    });
    for (const id of ids) setRenders((r) => ({ ...r, [id]: { status: "queued" as const } }));
    tracker.startWait("render");
    let failures = 0;
    try {
      for (const id of ids) {
        const concept = concepts.find((c) => c.id === id);
        if (!concept) continue;
        const key = keys[id];
        setRenders((r) => ({ ...r, [id]: { status: "rendering" } }));
        try {
          const base = { startSec: range.start, endSec: range.end, fit, cta: concept.cta, brand, concept, sessionId: tracker.sid ?? undefined };
          let result: RenderResult;
          let url: string | undefined;
          if (health?.stateless) {
            if (!sourceFile.current) throw new Error("The source video is no longer in this tab. Upload it again.");
            ({ result, url } = await renderInline(sourceFile.current, base));
          } else {
            result = await renderVariant({ ...base, jobId: source.jobId });
          }
          setRenders((r) => {
            if (r[id]?.status === "done" && (r[id] as { url?: string }).url) URL.revokeObjectURL((r[id] as { url: string }).url);
            return { ...r, [id]: { status: "done", result, version: Date.now(), key, url } };
          });
        } catch (err) {
          failures++;
          setRenders((r) => ({ ...r, [id]: { status: "error", message: err instanceof Error ? err.message : "Rendering failed." } }));
        }
      }
    } finally {
      tracker.endWait("render");
      rendering.current = false;
      setIsRendering(false);
    }
    const ok = ids.length - failures;
    if (failures) toast(`${failures} video${failures > 1 ? "s" : ""} failed. Use Retry on the failed one.`, "error");
    else toast(`${ok} video${ok > 1 ? "s are" : " is"} ready to review.`, "success");
  };

  const decide = (id: ConceptId, decision: "accepted" | "rejected") => {
    setDecisions((d) => ({ ...d, [id]: decision }));
    if (decision === "accepted") setReasons((r) => ({ ...r, [id]: "" }));
    tracker.track(decision === "accepted" ? "variant_accepted" : "variant_rejected", id);
    toast(decision === "accepted" ? "Accepted. You can download it now." : "Rejected.", decision === "accepted" ? "success" : "info");
  };

  const resetAll = () => {
    if (source) void deleteJob(source.jobId);
    tracker.end();
    sourceFile.current = null;
    setLocalSourceUrl(null);
    setSource(null);
    setFields(EMPTY_FIELDS);
    setConcepts([]);
    setSuggested([]);
    setGeneration(null);
    setStatus({});
    setCount(DEFAULT_CONCEPT_COUNT);
    setGeneratedKey("");
    setRenders({});
    setDecisions({});
    setReasons({});
    setDone(null);
    setFit("contain");
    setStep(0);
  };

  const startOver = () => {
    tracker.flushOnHide(); // keep the time spent on this abandoned attempt
    resetAll();
  };

  const finish = () => {
    const rendered = concepts.filter((c) => renders[c.id]?.status === "done");
    const effective = (id: ConceptId): Decision => (isStale(id) ? "pending" : (decisions[id] ?? "pending"));
    const accepted = rendered.filter((c) => effective(c.id) === "accepted").length;
    const open = rendered.filter((c) => effective(c.id) === "pending").length;
    if (open && !window.confirm(`${open} video${open > 1 ? "s have" : " has"} no decision yet. Finish anyway? You will not be able to export ${open > 1 ? "them" : "it"} afterwards.`)) return;
    tracker.track("session_completed");
    const items: DoneState["items"] = [];
    for (const c of rendered) {
      const r = renders[c.id];
      const d = effective(c.id);
      if (r?.status === "done" && (d === "accepted" || d === "rejected")) items.push({ concept: c, result: r.result, version: r.version, url: r.url, decision: d, reason: d === "rejected" ? (reasons[c.id] ?? "").trim() : "" });
    }
    setDone({ jobId: source?.jobId ?? "", sessionId: tracker.sid ?? "", items, summary: tracker.summary(), conceptStats: { generated: concepts.length, approved: concepts.filter((c) => status[c.id] === "approved").length, rejected: concepts.filter((c) => status[c.id] === "rejected").length } });
    tracker.end(); // the source video stays on disk until "Start a new session", so the downloads keep working
    toast(`Session saved: ${accepted} approved.`, "success");
  };

  const picked = selectedConcepts(concepts, status).map((c) => c.id);
  const pending = pendingRender();
  const reachable = Object.keys(renders).length ? 2 : concepts.length ? 1 : 0;
  const renderLabel = pending.length ? `Create ${pending.length} video${pending.length > 1 ? "s" : ""}` : "Back to review";
  const conceptStats = {
    generated: concepts.length,
    approved: concepts.filter((c) => status[c.id] === "approved").length,
    rejected: concepts.filter((c) => status[c.id] === "rejected").length,
  };
  const sid = tracker.sid ?? "";

  return (
    <main className={styles.page} id="main">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}><Icon icon={Film01Icon} size={22} /></span>
          <div>
            <p className={styles.eyebrow}>SockLock</p>
            <h1 className={styles.title}>Creative Variant Factory</h1>
          </div>
        </div>
        <div className={styles.headerSide}>
          <AiBadge status={health?.ai ?? null} provider={activeProvider} />
          {view === "factory" && !done && (source || concepts.length > 0) && step < 2 && <Button variant="ghost" icon={RefreshIcon} onClick={startOver}>Start over</Button>}
          {view === "factory" ? (
            <Button variant="ghost" icon={Analytics01Icon} onClick={showInsights}>Insights</Button>
          ) : (
            <Button variant="ghost" icon={ArrowLeft01Icon} onClick={showFactory}>Back to factory</Button>
          )}
        </div>
      </header>

      {health && !health.ok && (
        <div className={styles.banner} role="alert">
          <span><strong>Local setup needed.</strong> {health.problems.join(" ")}</span>
          <Button variant="secondary" icon={Refresh01Icon} loading={checking} onClick={recheck}>Check again</Button>
        </div>
      )}

      {view === "insights" ? (
        <div id="main-content" className={styles.body} ref={bodyRef}>
          <Insights />
        </div>
      ) : (
        <>
          {!done && <Stepper current={step} reachable={reachable} onGo={(i) => !isRendering && setStep(i)} />}

          <div className={styles.body} id="main-content" ref={bodyRef}>
            {done && <StepDone done={done} onExport={(id) => health?.stateless && tracker.exported(id)} onNew={resetAll} onInsights={showInsights} />}
            {!done && step === 0 && (
              <StepSource
                source={source}
                previewUrl={localSourceUrl}
                upload={upload}
                fields={fields}
                count={count}
                range={range}
                fit={fit}
                blocked={health ? !health.ok : false}
                loading={loadingConcepts}
                unchanged={briefUnchanged}
                ai={health?.ai ?? null}
                provider={activeProvider}
                onProvider={setProvider}
                onCount={setCount}
                onFile={handleFile}
                onFields={(next, delta) => {
                  tracker.begin();
                  tracker.addChars(delta);
                  setFields(next);
                }}
                onRange={(next) => {
                  tracker.countSegmentEdit();
                  invalidate(renderedIds(), "segment");
                  setRange(next);
                }}
                onFit={(f) => {
                  if (f !== fit) invalidate(renderedIds(), "fit");
                  setFit(f);
                }}
                onContinue={() => generate(false)}
              />
            )}
            {!done && step === 1 && (
              <StepVariations
                concepts={concepts}
                suggested={suggested}
                status={status}
                picked={picked}
                generation={generation}
                canRegenerate={activeProvider === "gemini" && Boolean(health?.ai.gemini.configured)}
                regenerating={loadingConcepts}
                onChange={updateConcept}
                onStatus={setConceptStatus}
                onRegenerate={regenerate}
                onBack={() => setStep(0)}
                hasSource={Boolean(source)}
                renderLabel={renderLabel}
                onRender={() => (pending.length ? runRenders(pending) : setStep(2))}
              />
            )}
            {!done && step === 2 && source && (
              <StepReview
                jobId={source.jobId}
                sessionId={sid}
                concepts={concepts}
                renders={renders}
                keys={keys}
                decisions={decisions}
                reasons={reasons}
                onReason={(id, text) => setReasons((r) => ({ ...r, [id]: text }))}
                busy={isRendering}
                summary={tracker.summary()}
                conceptStats={conceptStats}
                onExport={(id) => health?.stateless && tracker.exported(id)}
                onDecide={decide}
                onRetry={(id) => runRenders([id])}
                onUpdateOutdated={() => runRenders(pendingRender())}
                onEdit={() => setStep(1)}
                onFinish={finish}
                onInsights={showInsights}
              />
            )}
          </div>
        </>
      )}
    </main>
  );
}
