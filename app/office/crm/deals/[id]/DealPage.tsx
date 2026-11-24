"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../../office.module.css";
import { BizTag, ErrorBox } from "../../../components";
import { useBusinesses } from "../../../useBusinesses";
import { api } from "../../../../factory/connections/session";
import { officeInsert, officePatch, officeRest, officeToday, prettyDate, shiftDate } from "../../../lib/client";
import { Timeline } from "../../Timeline";
import { CONTACT_SELECT, DEAL_SELECT, money, toCents, type Company, type Contact, type Deal, type Pipeline } from "../../types";

export default function DealPage({ id }: { id: string }) {
  const { businesses } = useBusinesses();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [company, setCompany] = useState<Company | null>(null);
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", stage: "", value: "", recurring: "", expected: "", next: "", nextOn: "", contact: "", lost: "" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const d = (await officeRest<Deal[]>(`office_deals?id=eq.${id}&select=${DEAL_SELECT}&limit=1`))[0];
      if (!d) { setError("Deal not found."); return; }
      const [p, c, co] = await Promise.all([
        officeRest<Pipeline[]>(`office_pipelines?id=eq.${d.pipeline_id}&select=id,business_id,name,stages,sort_order`),
        officeRest<Contact[]>(`office_contacts?select=${CONTACT_SELECT}&order=name.asc&limit=1000`),
        d.company_id ? officeRest<Company[]>(`office_companies?id=eq.${d.company_id}&select=id,name,website,phone,notes,bill_customer_id`) : Promise.resolve([]),
      ]);
      setDeal(d); setPipeline(p[0] ?? null); setContacts(c); setCompany(co[0] ?? null);
      setProjectSlug(d.factory_project_id ? (await officeRest<{ slug: string }[]>(`factory_projects?id=eq.${d.factory_project_id}&select=slug`).catch(() => []))[0]?.slug ?? null : null);
      setF({ title: d.title, stage: d.stage, value: d.value_cents ? String(d.value_cents / 100) : "", recurring: d.recurring_cents ? String(d.recurring_cents / 100) : "", expected: d.expected_close || "", next: d.next_step || "", nextOn: d.next_step_on || "", contact: d.contact_id || "", lost: d.lost_reason || "" });
      setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the deal."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setDirty(true); };
  async function save() {
    if (!deal) return;
    try {
      const c = contacts.find((x) => x.id === f.contact);
      await officePatch("office_deals", `id=eq.${deal.id}`, {
        title: f.title.trim(), stage: f.stage, value_cents: toCents(f.value) || 0, recurring_cents: toCents(f.recurring) || 0,
        expected_close: f.expected || null, next_step: f.next.trim() || null, next_step_on: f.nextOn || null, contact_id: f.contact || null,
        company_id: deal.company_id || c?.company_id || null, lost_reason: f.lost.trim() || null,
      });
      setMsg("Saved.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }

  async function createInvoice() {
    if (!deal) return;
    setBusy("invoice");
    try {
      const entity = (await officeRest<{ id: string }[]>("acct_entities?select=id&limit=1"))[0];
      const contact = contacts.find((c) => c.id === deal.contact_id);
      let customerId = company?.bill_customer_id || null;
      if (!customerId && contact?.email) customerId = (await officeRest<{ id: string }[]>(`bill_customers?email=eq.${encodeURIComponent(contact.email)}&select=id&limit=1`))[0]?.id || null;
      if (!customerId) {
        customerId = (await officeInsert<{ id: string }>("bill_customers", { entity_id: entity.id, name: company?.name || contact?.name || deal.title, email: contact?.email || null, phone: contact?.phone || null })).id;
        if (company) await officePatch("office_companies", `id=eq.${company.id}`, { bill_customer_id: customerId });
      }
      const today = officeToday();
      const inv = await officeInsert<{ id: string }>("bill_invoices", { entity_id: entity.id, customer_id: customerId, business_id: deal.business_id, kind: "invoice", issue_date: today, due_date: shiftDate(today, 15), memo: deal.title });
      if (deal.value_cents > 0) await officeInsert("bill_invoice_lines", { invoice_id: inv.id, description: deal.title, quantity: 1, unit_price_cents: deal.value_cents, sort_order: 0 });
      await officePatch("office_deals", `id=eq.${deal.id}`, { invoice_id: inv.id });
      window.location.assign(`/office/billing/${inv.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the invoice."); setBusy(""); }
  }
  async function startProject() {
    if (!deal) return;
    setBusy("factory");
    try {
      const r = await api<{ project_id: string; slug?: string; existing?: boolean }>("/api/office/crm/factory", { method: "POST", body: JSON.stringify({ deal_id: deal.id }) });
      setMsg(r.existing ? "This deal already has a Factory project." : "Factory project created in Discovery.");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the project."); }
    finally { setBusy(""); }
  }

  if (!deal || !pipeline) return <section className={styles.page}><ErrorBox message={error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;
  const contact = contacts.find((c) => c.id === deal.contact_id) || null;
  const stage = pipeline.stages.find((s) => s.key === f.stage);

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <a className={styles.smallLink} href="/office/crm">← Pipeline</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div>
          <span className="product-tag">{pipeline.name}</span>
          <h1>{deal.title}</h1>
          <p className={styles.taskMeta}>
            <span className={`${styles.statusPill} ${deal.status === "won" ? styles.st_paid : deal.status === "lost" ? styles.st_void : ""}`}>{pipeline.stages.find((s) => s.key === deal.stage)?.label}</span>
            <BizTag business={businesses.find((b) => b.id === deal.business_id)} />
            {Number(deal.value_cents) > 0 && <span>{money(deal.value_cents)}{Number(deal.recurring_cents) > 0 ? ` + ${money(deal.recurring_cents)}/mo` : ""}</span>}
            {company && <span>{company.name}</span>}
          </p>
        </div>
        <div className={styles.headerActions}><button className="button button-primary" disabled={!dirty} onClick={() => void save()}>Save</button></div>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={styles.twoCol} style={{ marginTop: 0 }}>
        <div className={styles.stack}>
          <article className={styles.card}>
            <div className={styles.formGrid}>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>Deal<input value={f.title} onChange={(e) => set({ title: e.target.value })} /></label>
              <label className={styles.field}>Stage
                <select value={f.stage} onChange={(e) => set({ stage: e.target.value })}>{pipeline.stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
              </label>
              <label className={styles.field}>Contact
                <select value={f.contact} onChange={(e) => set({ contact: e.target.value })}>
                  <option value="">None</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className={styles.field}>One-time value ($)<input inputMode="decimal" value={f.value} onChange={(e) => set({ value: e.target.value })} /></label>
              <label className={styles.field}>Monthly value ($)<input inputMode="decimal" value={f.recurring} onChange={(e) => set({ recurring: e.target.value })} /></label>
              <label className={styles.field}>Next step<input value={f.next} onChange={(e) => set({ next: e.target.value })} placeholder="Send proposal" /></label>
              <label className={styles.field}>By<input type="date" value={f.nextOn} onChange={(e) => set({ nextOn: e.target.value })} /></label>
              <label className={styles.field}>Expected close<input type="date" value={f.expected} onChange={(e) => set({ expected: e.target.value })} /></label>
              {stage?.kind === "lost" && <label className={styles.field}>Why lost<input value={f.lost} onChange={(e) => set({ lost: e.target.value })} /></label>}
            </div>
            <small className={styles.muted}>Created {prettyDate(deal.created_at.slice(0, 10))}{deal.source ? ` from ${deal.source}` : ""}{deal.last_activity_at ? ` · last activity ${prettyDate(deal.last_activity_at.slice(0, 10))}` : ""}</small>
          </article>

          {deal.status === "won" && (
            <article className={styles.card}>
              <h2>Won: next steps</h2>
              <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                {deal.invoice_id
                  ? <a className="button button-secondary" href={`/office/billing/${deal.invoice_id}`}>Open invoice</a>
                  : <button className="button button-primary" disabled={!!busy} onClick={() => void createInvoice()}>{busy === "invoice" ? "Creating…" : "Create invoice"}</button>}
                {deal.factory_project_id
                  ? <a className="button button-secondary" href={projectSlug ? `/factory/projects/${projectSlug}` : "/factory/dashboard"}>Open Factory project</a>
                  : <button className="button button-secondary" disabled={!!busy} onClick={() => void startProject()}>{busy === "factory" ? "Creating…" : "Start Factory project"}</button>}
                {Number(deal.recurring_cents) > 0 && <a className={styles.smallLink} href="/office/billing">Set up the {money(deal.recurring_cents)}/mo recurring invoice →</a>}
              </div>
              <small className={styles.muted}>The invoice starts as a draft with this deal's value; review it before sending.</small>
            </article>
          )}

          {contact && (
            <article className={styles.card}>
              <h2>{contact.name}</h2>
              <small className={styles.muted}>{[contact.title, company?.name, contact.email, contact.phone].filter(Boolean).join(" · ")}</small>
              <a className={styles.smallLink} href={`/office/crm/contacts/${contact.id}`}>Open contact →</a>
            </article>
          )}
        </div>
        <div className={styles.stack}>
          <Timeline contact={contact} dealId={deal.id} companyId={deal.company_id} onError={setError} />
        </div>
      </div>
    </section>
  );
}
