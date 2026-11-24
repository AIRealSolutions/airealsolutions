// Everything the Office knows about one business, for the Incubator's AI drafter, reviewer and advisor. Server-only.
import { HttpError } from "../integrations/server";
import { officeDate, type Rest } from "./server";

const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : s);
const optional = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

export type VentureBusiness = { id: string; name: string; slug: string; relationship: string; category: string | null; summary: string | null; website: string | null; status: string; weekly_focus: string | null; factory_project_id: string | null };

export async function loadVentureContext(rest: Rest, businessId: string, opts: { excludeDocKind?: string; docChars?: number } = {}) {
  const biz = (await rest<VentureBusiness[]>(`office_businesses?id=eq.${businessId}&select=id,name,slug,relationship,category,summary,website,status,weekly_focus,factory_project_id&limit=1`))[0];
  if (!biz) throw new HttpError(404, "Business not found.");
  const year = officeDate().slice(0, 4);
  const pid = biz.factory_project_id;

  const [venture, project, synthesis, economics, goals, tasks, notes, deals, products, items, docs, entity] = await Promise.all([
    optional(rest<unknown[]>(`office_ventures?business_id=eq.${businessId}&select=stage,sale_models,asking_price_cents,license_summary,notes`), []),
    pid ? optional(rest<unknown[]>(`factory_projects?id=eq.${pid}&select=name,stage,summary,industry,project_type,next_action,automation_summary,product_url`), []) : Promise.resolve([]),
    pid ? optional(rest<{ content: Record<string, unknown> }[]>(`factory_product_syntheses?project_id=eq.${pid}&select=content&order=version.desc&limit=1`), []) : Promise.resolve([]),
    pid ? optional(rest<Record<string, unknown>[]>(`factory_project_economics?project_id=eq.${pid}&select=*`), []) : Promise.resolve([]),
    optional(rest<unknown[]>(`office_goals?business_id=eq.${businessId}&select=level,title,status,target_value,current_value,unit&limit=40`), []),
    optional(rest<unknown[]>(`office_tasks?business_id=eq.${businessId}&status=eq.todo&select=title,due_on&limit=40`), []),
    optional(rest<{ title: string; body: string }[]>(`office_notes?business_id=eq.${businessId}&select=title,body&order=updated_at.desc&limit=10`), []),
    optional(rest<{ title: string; status: string; value_cents: number }[]>(`office_deals?business_id=eq.${businessId}&select=title,status,value_cents&limit=100`), []),
    optional(rest<{ name: string; unit_price_cents: number; unit: string; recurring_interval: string | null }[]>(`bill_products?business_id=eq.${businessId}&active=eq.true&select=name,unit_price_cents,unit,recurring_interval`), []),
    optional(rest<{ track: string; category: string; title: string; status: string }[]>(`office_readiness_items?business_id=eq.${businessId}&select=track,category,title,status&order=sort_order.asc`), []),
    optional(rest<{ kind: string; version: number; status: string; content: { sections?: { title: string; body: string }[] } }[]>(`office_venture_docs?business_id=eq.${businessId}${opts.excludeDocKind ? `&kind=neq.${opts.excludeDocKind}` : ""}&select=kind,version,status,content&order=version.desc`), []),
    optional(rest<{ id: string }[]>("acct_entities?select=id&limit=1"), []),
  ]);

  let books: object | null = null;
  if (entity[0]) {
    const [pl, accts] = await Promise.all([
      optional(rest<{ business_id: string | null; account_id: string; amount_cents: number }[]>("rpc/acct_pl_by_business", { method: "POST", body: JSON.stringify({ p_entity: entity[0].id, p_from: `${year}-01-01`, p_to: officeDate() }) }), []),
      optional(rest<{ id: string; type: string; name: string }[]>("acct_accounts?select=id,type,name"), []),
    ]);
    const mine = pl.filter((r) => r.business_id === businessId);
    const sum = (t: string) => mine.filter((r) => accts.find((a) => a.id === r.account_id)?.type === t).reduce((n, r) => n + Number(r.amount_cents), 0) / 100;
    books = { year, income_usd: sum("income"), expenses_usd: sum("expense") };
  }
  const latest = new Map<string, unknown>();
  for (const d of docs) if (!latest.has(d.kind)) latest.set(d.kind, { version: d.version, status: d.status, sections: (d.content.sections || []).map((s) => ({ title: s.title, body: clip(s.body, opts.docChars ?? 1500) })) });
  const track = (t: string) => {
    const list = items.filter((i) => i.track === t);
    const applies = list.filter((i) => i.status !== "na");
    return { done: applies.filter((i) => i.status === "done").length, total: applies.length, open: list.filter((i) => i.status === "todo" || i.status === "doing").map((i) => `${i.category}: ${i.title}`) };
  };

  return {
    biz,
    items,
    material: {
      business: { ...biz, owned_by_ai_real_solutions: biz.relationship !== "client" },
      incubator: venture[0] ?? null,
      factory_project: project[0] ?? null,
      factory_spec: synthesis[0]?.content ? Object.fromEntries(Object.entries(synthesis[0].content).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 15) : clip(v, 1500)])) : null,
      factory_economics: economics[0] ?? null,
      goals, open_tasks: tasks, notes: notes.map((n) => ({ title: n.title, body: clip(n.body, 800) })),
      crm: { deals: deals.length, open: deals.filter((d) => d.status === "open").length, won: deals.filter((d) => d.status === "won").length, open_value_usd: deals.filter((d) => d.status === "open").reduce((n, d) => n + Number(d.value_cents), 0) / 100 },
      price_list: products.map((p) => ({ name: p.name, usd: p.unit_price_cents / 100, per: p.unit, recurring: p.recurring_interval })),
      books,
      readiness: { production: track("production"), sale: biz.relationship === "client" ? null : track("sale") },
      documents: Object.fromEntries(latest),
    },
  };
}
