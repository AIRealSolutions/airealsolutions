// Ask the Incubator advisor about one business. POST { business_id, question } as an admin.
// Stores the question and the answer (with any suggested tasks or checklist items) in the conversation.
import { officeAiConfigured, runAdvisor } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";
import { loadVentureContext } from "../../../../lib/office/venture-context";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { business_id, question } = await readJson<{ business_id?: string; question?: string }>(request);
    const q = String(question || "").trim();
    if (!business_id || !/^[0-9a-f-]{36}$/i.test(business_id) || !q) throw new HttpError(400, "business_id and question are required.");
    if (q.length > 4000) throw new HttpError(413, "Keep questions under 4,000 characters.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const asked = Date.now();
    const [{ biz, material }, history] = await Promise.all([
      loadVentureContext(rest, business_id, { docChars: 1200 }),
      rest<{ role: "user" | "assistant"; content: string }[]>(`office_venture_chats?business_id=eq.${business_id}&select=role,content&order=created_at.desc&limit=12`),
    ]);
    const { data } = await runAdvisor(material, history.reverse().map((m) => ({ role: m.role, content: m.content.slice(0, 3000) })), q);
    const actions = (data.actions || []).slice(0, 5).map((a) => ({
      type: a.type === "checklist" ? "checklist" : "task", track: biz.relationship === "client" ? "production" : a.track === "sale" ? "sale" : "production",
      category: a.category, title: String(a.title || "").slice(0, 200), detail: String(a.detail || "").slice(0, 500),
    })).filter((a) => a.title);
    const rows = await rest<unknown[]>("office_venture_chats?select=*", {
      method: "POST", headers: { Prefer: "return=representation" },
      // Explicit times keep the question before its answer when both are saved together.
      body: JSON.stringify([
        { business_id, role: "user", content: q, created_at: new Date(asked).toISOString() },
        { business_id, role: "assistant", content: String(data.answer || "").slice(0, 20000), actions, created_at: new Date(Math.max(Date.now(), asked + 1)).toISOString() },
      ]),
    });
    return Response.json({ messages: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
