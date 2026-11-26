// Review and critique one plan document version with AI. POST { doc_id } as an admin. Saves and returns the review.
import { officeAiConfigured, runPlanReview } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson } from "../../../../lib/integrations/server";
import { asUser, requireOffice, WORK } from "../../../../lib/office/server";
import { loadVentureContext } from "../../../../lib/office/venture-context";
import { DOC_SECTIONS, type DocKind } from "../../../../lib/office/venture-docs";
import { logged } from "../../../../lib/office/agent-log";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const { doc_id } = await readJson<{ doc_id?: string }>(request);
    if (!doc_id || !/^[0-9a-f-]{36}$/i.test(doc_id)) throw new HttpError(400, "doc_id is required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const doc = (await rest<{ id: string; business_id: string; kind: DocKind; version: number; content: { sections: { key: string; title: string; body: string }[] } }[]>(
      `office_venture_docs?id=eq.${doc_id}&select=id,business_id,kind,version,content&limit=1`))[0];
    if (!doc) throw new HttpError(404, "Document not found.");
    if (!doc.content.sections.some((s) => s.body.trim())) throw new HttpError(400, "The document is empty. Write or draft it first.");
    const { biz, items, material } = await loadVentureContext(rest, doc.business_id, { excludeDocKind: doc.kind, docChars: 800 });

    const outline = DOC_SECTIONS[doc.kind];
    const { data, usage } = await logged(rest, "plan-reviewer", () => runPlanReview(doc.kind, outline, { version: doc.version, sections: doc.content.sections }, material));
    const keys = new Set(outline.map((o) => o.key));
    const existing = new Set(items.map((i) => `${i.track}|${i.title.toLowerCase()}`));
    const n = (v: unknown, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v) || lo)));
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, max) : []);
    const review = {
      score: n(data.score, 1, 10),
      verdict: String(data.verdict || "").slice(0, 1500),
      strengths: list(data.strengths, 6), weaknesses: list(data.weaknesses, 6),
      sections: (data.sections || []).filter((s) => keys.has(s.key)).map((s) => ({ key: s.key, score: n(s.score, 1, 10), critique: String(s.critique || "").slice(0, 1000), suggestion: String(s.suggestion || "").slice(0, 12000) })),
      missing: list(data.missing, 8), questions: list(data.questions, 6),
      readiness: (data.readiness || [])
        .map((g) => ({ track: biz.relationship === "client" ? "production" : g.track === "sale" ? "sale" : "production", category: g.category, title: String(g.title || "").trim().slice(0, 200), detail: String(g.detail || "").slice(0, 500) }))
        .filter((g) => g.title && !existing.has(`${g.track}|${g.title.toLowerCase()}`)).slice(0, 8),
    };
    const saved = (await rest<unknown[]>("office_venture_reviews?select=*", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ doc_id: doc.id, business_id: doc.business_id, review, model: usage.model }),
    }))[0];
    return Response.json({ review: saved });
  } catch (e) {
    return errorResponse(e);
  }
}
