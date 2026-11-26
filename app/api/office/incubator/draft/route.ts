// Draft a plan document for one business with AI. POST { business_id, kind } as an admin.
// Saves a new draft version and returns it (with readiness gaps found).
import { officeAiConfigured, runVentureDoc } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson } from "../../../../lib/integrations/server";
import { asUser, requireOffice, WORK } from "../../../../lib/office/server";
import { loadVentureContext } from "../../../../lib/office/venture-context";
import { DOC_SECTIONS, docKindsFor, type DocKind } from "../../../../lib/office/venture-docs";
import { logged } from "../../../../lib/office/agent-log";

export const maxDuration = 300;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const { business_id, kind } = await readJson<{ business_id?: string; kind?: DocKind }>(request);
    if (!business_id || !UUID.test(business_id) || !kind || !DOC_SECTIONS[kind]) throw new HttpError(400, "business_id and kind are required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const { biz, items, material } = await loadVentureContext(rest, business_id, { excludeDocKind: kind });
    if (!docKindsFor(biz.relationship).includes(kind)) throw new HttpError(400, "That document doesn't apply to a client business.");

    const outline = DOC_SECTIONS[kind];
    const { data, usage } = await logged(rest, "plan-drafter", () => runVentureDoc(kind, outline, material));
    const sections = outline.map((o) => ({ key: o.key, title: o.title, body: String(data.sections.find((s) => s.key === o.key)?.body || "").trim().slice(0, 12000) }));
    const existing = new Set(items.map((i) => `${i.track}|${i.title.toLowerCase()}`));
    const gaps = (data.gaps || [])
      .map((g) => ({ track: biz.relationship === "client" ? "production" : g.track === "sale" ? "sale" : "production", category: g.category, title: String(g.title || "").trim().slice(0, 200), detail: String(g.detail || "").slice(0, 500) }))
      .filter((g) => g.title && !existing.has(`${g.track}|${g.title.toLowerCase()}`)).slice(0, 8);

    const last = await rest<{ version: number }[]>(`office_venture_docs?business_id=eq.${business_id}&kind=eq.${kind}&select=version&order=version.desc&limit=1`);
    const doc = (await rest<unknown[]>("office_venture_docs?select=*", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ business_id, kind, version: (last[0]?.version || 0) + 1, content: { sections, gaps }, status: "draft", source: "ai", model: usage.model }),
    }))[0];
    return Response.json({ doc });
  } catch (e) {
    return errorResponse(e);
  }
}
