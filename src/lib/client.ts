import type { InsightsReport, Scope } from "@/lib/analytics";
import type { ApiError, ConceptRequest, ConceptResponse, HealthReport, RenderRequest, RenderResult, SourceInfo } from "@/lib/types";

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? "Something went wrong. Please try again.");
  return data;
}

const post = <T>(url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => parse<T>(r));

export const getHealth = () => fetch("/api/health", { cache: "no-store" }).then((r) => parse<HealthReport>(r));
export const getConcepts = (req: ConceptRequest) => post<ConceptResponse>("/api/concepts", req);
export const renderVariant = (req: RenderRequest) => post<RenderResult>("/api/render", req);
export const deleteJob = (id: string) => fetch(`/api/jobs/${id}`, { method: "DELETE" }).catch(() => undefined);

export function uploadSource(file: File, onProgress: (pct: number) => void, sessionId?: string): Promise<SourceInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/source");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    if (sessionId) xhr.setRequestHeader("x-session-id", sessionId);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress((e.loaded / e.total) * 100);
    xhr.onerror = () => reject(new Error("Network error while uploading. Is the dev server still running?"));
    xhr.onload = () => {
      if (xhr.status === 413) return reject(new Error("This host rejects uploads that large (Vercel allows about 4.5 MB). Use a shorter or more compressed clip, or run the app locally."));
      try {
        const data = JSON.parse(xhr.responseText) as SourceInfo & Partial<ApiError>;
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error ?? "Upload failed."));
      } catch {
        reject(new Error("Unexpected server response."));
      }
    };
    xhr.send(file);
  });
}

export const sourceUrl = (jobId: string) => `/api/jobs/${jobId}/source`;
/** Downloads carry the session id so the server can log an export when it actually serves the file. */
export const outputUrl = (jobId: string, file: string, v: number, download?: { sessionId: string }) =>
  `/api/jobs/${jobId}/output/${file}?v=${v}${download ? `&download=1&sid=${download.sessionId}` : ""}`;

export const getInsights = (scope: Scope) => fetch(`/api/insights?scope=${scope}`, { cache: "no-store" }).then((r) => parse<InsightsReport>(r));
export const insightsCsvUrl = (kind: "sessions" | "events", scope: Scope) => `/api/insights/export?kind=${kind}&scope=${scope}`;

export const fmtTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
export const fmtBytes = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

export const fmtDuration = (sec: number) => {
  const s = Math.round(sec);
  return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
};
