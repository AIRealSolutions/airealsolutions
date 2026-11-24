// CRM server helpers: website lead intake and the daily follow-up job. Server-only.
import { addDays, type Rest } from "./server";

export type Lead = { name: string; email: string; phone?: string; company?: string; message?: string; business?: string; source?: string };
type Stage = { key: string; label: string; kind: "open" | "won" | "lost" };

const one = <T>(rows: T[]) => rows[0] ?? null;
/** Exact, case-insensitive match for PostgREST ilike: escape its wildcards. */
const exact = (v: string) => encodeURIComponent(v.replace(/[\\%_*]/g, (c) => `\\${c}`));
const post = <T>(rest: Rest, path: string, row: object, prefer = "return=representation") =>
  rest<T[]>(path, { method: "POST", headers: { Prefer: prefer }, body: JSON.stringify(row) });

/** File a website lead: contact (merged by email), company, business tag, open deal, timeline entry, reminder. */
export async function intakeLead(rest: Rest, lead: Lead) {
  const email = lead.email.trim().toLowerCase();
  const businesses = await rest<{ id: string; slug: string; name: string; relationship: string }[]>("office_businesses?select=id,slug,name,relationship");
  const biz = businesses.find((b) => b.slug === lead.business) || businesses.find((b) => b.slug === "ai-real-solutions") || businesses[0];

  let contact = one(await rest<{ id: string; company_id: string | null; phone: string | null }[]>(`office_contacts?email=ilike.${exact(email)}&select=id,company_id,phone&limit=1`));
  if (!contact) {
    contact = one(await post<{ id: string; company_id: string | null; phone: string | null }>(rest, "office_contacts?select=id,company_id,phone", { name: lead.name, email, phone: lead.phone || null, source: lead.source || "website" }));
  } else if (!contact.phone && lead.phone) {
    await rest(`office_contacts?id=eq.${contact.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ phone: lead.phone }) });
  }
  if (!contact) throw new Error("Could not save the contact.");

  let companyId = contact.company_id;
  if (!companyId && lead.company) {
    const found = one(await rest<{ id: string }[]>(`office_companies?name=ilike.${exact(lead.company.replace(/[,()]/g, " ").trim())}&select=id&limit=1`));
    companyId = found?.id || one(await post<{ id: string }>(rest, "office_companies?select=id", { name: lead.company }))?.id || null;
    if (companyId) await rest(`office_contacts?id=eq.${contact.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ company_id: companyId }) });
  }

  if (biz) await post(rest, "office_contact_businesses?on_conflict=contact_id,business_id", { contact_id: contact.id, business_id: biz.id, role: "lead" }, "resolution=ignore-duplicates,return=minimal");

  // An open deal in the business's pipeline (the company pipeline for clients and businesses without one).
  const pipelines = await rest<{ id: string; business_id: string | null; stages: Stage[] }[]>("office_pipelines?select=id,business_id,stages&order=sort_order.asc");
  const ars = businesses.find((b) => b.slug === "ai-real-solutions");
  const pipeline = pipelines.find((p) => p.business_id === biz?.id) || pipelines.find((p) => p.business_id === ars?.id) || pipelines[0];
  let dealId: string | null = null;
  if (pipeline) {
    const open = one(await rest<{ id: string }[]>(`office_deals?pipeline_id=eq.${pipeline.id}&contact_id=eq.${contact.id}&status=eq.open&select=id&limit=1`));
    dealId = open?.id || one(await post<{ id: string }>(rest, "office_deals?select=id", {
      pipeline_id: pipeline.id, business_id: biz?.id ?? null, title: `${lead.company || lead.name} — ${biz?.name || "website"} inquiry`.slice(0, 200),
      contact_id: contact.id, company_id: companyId, stage: (pipeline.stages.find((s) => s.kind === "open") || pipeline.stages[0]).key, source: lead.source || "website",
    }))?.id || null;
  }

  await post(rest, "office_activities", {
    contact_id: contact.id, company_id: companyId, deal_id: dealId, kind: "form", direction: "in",
    subject: `Website form${lead.source ? ` (${lead.source})` : ""}`, body: lead.message || null,
  }, "return=minimal");
  await post(rest, "office_reminders", { title: `New lead: ${lead.name}${lead.company ? ` (${lead.company})` : ""} for ${biz?.name || "AI Real Solutions"}: reply today`, business_id: biz?.id ?? null, remind_at: new Date().toISOString() }, "return=minimal");
  await post(rest, "office_feed_items?on_conflict=dedupe_key", {
    business_id: biz?.id ?? null, kind: "internal", title: `New lead: ${lead.name}${lead.company ? `, ${lead.company}` : ""}`, source_name: "CRM",
    summary: lead.message ? lead.message.slice(0, 300) : null, published_at: new Date().toISOString(), dedupe_key: `lead:${contact.id}:${Date.now()}`,
  }, "resolution=ignore-duplicates,return=minimal").catch(() => undefined);
  return { contact_id: contact.id, deal_id: dealId };
}

/** Daily: remind about due next steps and deals that have gone quiet (never sends anything). */
export async function runCrmDaily(rest: Rest, today: string) {
  const deals = await rest<{ id: string; title: string; next_step: string | null; next_step_on: string | null; last_activity_at: string | null; created_at: string; reminded_on: string | null; business_id: string | null }[]>(
    "office_deals?status=eq.open&select=id,title,next_step,next_step_on,last_activity_at,created_at,reminded_on,business_id&limit=500",
  );
  const quietBefore = Date.now() - 14 * 86_400_000;
  let reminded = 0;
  for (const d of deals) {
    let title: string | null = null;
    if (d.next_step_on && d.next_step_on <= today && (!d.reminded_on || d.reminded_on < d.next_step_on)) {
      title = `Follow up on ${d.title}${d.next_step ? `: ${d.next_step}` : ""}`;
    } else if (Date.parse(d.last_activity_at || d.created_at) < quietBefore && (!d.reminded_on || d.reminded_on < addDays(today, -7))) {
      title = `${d.title} has gone quiet for 2+ weeks: draft a follow-up in the CRM`;
    }
    if (!title) continue;
    await post(rest, "office_reminders", { title: title.slice(0, 300), business_id: d.business_id, remind_at: new Date().toISOString() }, "return=minimal");
    await rest(`office_deals?id=eq.${d.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ reminded_on: today }) });
    reminded++;
  }
  return { reminded };
}
