// Draft a business plan, marketing plan or licensing & sale offer for one product with AI.
// POST { business_id, kind } as an admin. Saves a new draft version and returns it (with gaps found).
import { officeAiConfigured, runVentureDoc } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser, officeDate } from "../../../../lib/office/server";
import { DOC_SECTIONS, type DocKind } from "../../../../lib/office/venture-docs";

export const maxDuration = 300;
const UUID = /^[0-9a-f-]{36}$/i;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.slice(0, n) : s);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { business_id, kind } = await readJson<{ business_id?: string; kind?: DocKind }>(request);
    if (!business_id || !UUID.test(business_id) || !kind || !DOC_SECTIONS[kind]) throw new HttpError(400, "business_id and kind are required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const optional = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);

    const biz = (await rest<{ id: string; name: string; slug: string; category: string | null; summary: string | null; website: string | null; status: string; weekly_focus: string | null; factory_project_id: string | null }[]>(
      `office_businesses?id=eq.${business_id}&select=id,name,slug,category,summary,website,status,weekly_focus,factory_project_id&limit=1`))[0];
    if (!biz) throw new HttpError(404, "Product not found.");
    const year = officeDate().slice(0, 4);
    const pid = biz.factory_project_id;

    const [venture, project, synthesis, economics, goals, tasks, notes, deals, products, items, docs, entity] = await Promise.all([
      optional(rest<unknown[]>(`office_ventures?business_id=eq.${business_id}&select=stage,sale_models,asking_price_cents,license_summary,notes`), []),
      pid ? optional(rest<unknown[]>(`factory_projects?id=eq.${pid}&select=name,stage,summary,industry,project_type,next_action,automation_summary,product_url`), []) : Promise.resolve([]),
      pid ? optional(rest<{ content: Record<string, unknown> }[]>(`factory_product_syntheses?project_id=eq.${pid}&select=content&order=version.desc&limit=1`), []) : Promise.resolve([]),
      pid ? optional(rest<Record<string, unknown>[]>(`factory_project_economics?project_id=eq.${pid}&select=*`), []) : Promise.resolve([]),
      optional(rest<{ level: string; title: string; status: string; target_value: number | null; current_value: number; unit: string | null }[]>(`office_goals?business_id=eq.${business_id}&select=level,title,status,target_value,current_value,unit&limit=40`), []),
      optional(rest<{ title: string; status: string; due_on: string | null }[]>(`office_tasks?business_id=eq.${business_id}&status=eq.todo&select=title,due_on&limit=40`), []),
      optional(rest<{ title: string; body: string }[]>(`office_notes?business_id=eq.${business_id}&select=title,body&order=updated_at.desc&limit=10`), []),
      optional(rest<{ title: string; status: string; value_cents: number; recurring_cents: number }[]>(`office_deals?business_id=eq.${business_id}&select=title,status,value_cents,recurring_cents&limit=100`), []),
      optional(rest<{ name: string; unit_price_cents: number; unit: string; recurring_interval: string | null }[]>(`bill_products?business_id=eq.${business_id}&active=eq.true&select=name,unit_price_cents,unit,recurring_interval`), []),
      optional(rest<{ category: string; title: string; status: string }[]>(`office_readiness_items?business_id=eq.${business_id}&select=category,title,status&order=sort_order.asc`), []),
      optional(rest<{ kind: string; status: string; content: { sections?: { title: string; body: string }[] } }[]>(`office_venture_docs?business_id=eq.${business_id}&kind=neq.${kind}&select=kind,status,content&order=version.desc`), []),
      optional(rest<{ id: string }[]>("acct_entities?select=id&limit=1"), []),
    ]);

    // Real numbers from the books for this business line, this year.
    let books: object | null = null;
    if (entity[0]) {
      const [pl, accts] = await Promise.all([
        optional(rest<{ business_id: string | null; account_id: string; amount_cents: number }[]>("rpc/acct_pl_by_business", { method: "POST", body: JSON.stringify({ p_entity: entity[0].id, p_from: `${year}-01-01`, p_to: officeDate() }) }), []),
        optional(rest<{ id: string; type: string; name: string }[]>("acct_accounts?select=id,type,name"), []),
      ]);
      const mine = pl.filter((r) => r.business_id === business_id);
      const sum = (t: string) => mine.filter((r) => accts.find((a) => a.id === r.account_id)?.type === t).reduce((n, r) => n + Number(r.amount_cents), 0) / 100;
      books = { year, income_usd: sum("income"), expenses_usd: sum("expense"), by_account: mine.map((r) => ({ account: accts.find((a) => a.id === r.account_id)?.name, usd: Number(r.amount_cents) / 100 })) };
    }
    const latestOther = new Map<string, unknown>();
    for (const d of docs) if (!latestOther.has(d.kind)) latestOther.set(d.kind, { status: d.status, sections: (d.content.sections || []).map((s) => ({ title: s.title, body: clip(s.body, 1500) })) });

    const outline = DOC_SECTIONS[kind];
    const { data, usage } = await runVentureDoc(kind, outline, {
      product: biz, incubator: venture[0] ?? null,
      factory_project: project[0] ?? null,
      factory_spec: synthesis[0]?.content ? Object.fromEntries(Object.entries(synthesis[0].content).map(([k, v]) => [k, Array.isArray(v) ? v.slice(0, 15) : clip(v, 1500)])) : null,
      factory_economics: economics[0] ?? null,
      goals, open_tasks: tasks, notes: notes.map((n) => ({ title: n.title, body: clip(n.body, 800) })),
      crm: { deals: deals.length, open: deals.filter((d) => d.status === "open").length, won: deals.filter((d) => d.status === "won").length, open_value_usd: deals.filter((d) => d.status === "open").reduce((n, d) => n + Number(d.value_cents), 0) / 100, examples: deals.slice(0, 10).map((d) => d.title) },
      price_list: products.map((p) => ({ name: p.name, usd: p.unit_price_cents / 100, per: p.unit, recurring: p.recurring_interval })),
      books, readiness_checklist: items, other_documents: Object.fromEntries(latestOther),
    });

    // Keep the outline's order and titles; fill any section the AI skipped.
    const sections = outline.map((o) => ({ key: o.key, title: o.title, body: String(data.sections.find((s) => s.key === o.key)?.body || "").trim().slice(0, 12000) }));
    const existing = new Set(items.map((i) => i.title.toLowerCase()));
    const gaps = (data.gaps || []).filter((g) => g.title?.trim() && !existing.has(g.title.trim().toLowerCase())).slice(0, 8)
      .map((g) => ({ category: g.category, title: g.title.trim().slice(0, 200), detail: String(g.detail || "").slice(0, 500) }));

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
