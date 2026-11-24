// Draft a follow-up email with AI. POST { contact_id, deal_id? } as an admin. Nothing is sent here.
import { officeAiConfigured, runFollowUpDraft } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 60;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { contact_id, deal_id } = await readJson<{ contact_id?: string; deal_id?: string }>(request);
    if (!contact_id || !UUID.test(contact_id) || (deal_id && !UUID.test(deal_id))) throw new HttpError(400, "contact_id is required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const [contact, deal, acts] = await Promise.all([
      rest<{ name: string; email: string | null; title: string | null; notes: string | null; office_companies: { name: string } | null }[]>(`office_contacts?id=eq.${contact_id}&select=name,email,title,notes,office_companies(name)&limit=1`),
      deal_id ? rest<{ title: string; stage: string; next_step: string | null; value_cents: number; office_pipelines: { stages: { key: string; label: string }[] } | null; office_businesses: { name: string } | null }[]>(`office_deals?id=eq.${deal_id}&select=title,stage,next_step,value_cents,office_pipelines(stages),office_businesses(name)&limit=1`) : Promise.resolve([]),
      rest<{ kind: string; direction: string | null; subject: string | null; body: string | null; occurred_at: string }[]>(`office_activities?contact_id=eq.${contact_id}&select=kind,direction,subject,body,occurred_at&order=occurred_at.desc&limit=8`),
    ]);
    if (!contact[0]) throw new HttpError(404, "Contact not found.");
    const d = deal[0];
    const { data } = await runFollowUpDraft({
      contact: { name: contact[0].name, title: contact[0].title, company: contact[0].office_companies?.name, notes: contact[0].notes },
      deal: d ? { title: d.title, business: d.office_businesses?.name, stage: d.office_pipelines?.stages.find((s) => s.key === d.stage)?.label || d.stage, next_step: d.next_step } : null,
      recent_activity: acts.map((a) => ({ when: a.occurred_at.slice(0, 10), kind: a.kind, direction: a.direction, subject: a.subject, body: (a.body || "").slice(0, 600) })),
    }, (process.env.OFFICE_SIGNATURE || "Best,\nAI Real Solutions").replace(/\\n/g, "\n"));
    return Response.json({ subject: data.subject.slice(0, 200), body: data.body.slice(0, 5000) });
  } catch (e) {
    return errorResponse(e);
  }
}
