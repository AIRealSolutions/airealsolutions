"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeInsert, officePatch, officeRest, officeToday, prettyDate, type Business } from "../lib/client";
import { CONTACT_SELECT, DEAL_SELECT, money, toCents, type Company, type Contact, type ContactBusiness, type Deal, type Pipeline } from "./types";

type Tab = "pipeline" | "contacts" | "companies";

export default function CrmBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [tab, setTab] = useState<Tab>("pipeline");
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { try { const t = localStorage.getItem("office.crm.tab") as Tab | null; if (t) setTab(t); } catch { /* ignore */ } }, []);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem("office.crm.tab", t); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    try {
      const [p, c, co] = await Promise.all([
        officeRest<Pipeline[]>("office_pipelines?select=id,business_id,name,stages,sort_order&order=sort_order.asc"),
        officeRest<Contact[]>(`office_contacts?select=${CONTACT_SELECT}&order=name.asc&limit=1000`),
        officeRest<Company[]>("office_companies?select=id,name,website,phone,notes,bill_customer_id&order=name.asc&limit=1000"),
      ]);
      setPipelines(p); setContacts(c); setCompanies(co);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the CRM.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Run</span>
        <h1>CRM</h1>
        <p>Prospects and clients for AI Real Solutions and its ventures. Website leads land here on their own; won deals become invoices or Factory projects.</p>
      </header>
      <ErrorBox message={bizError || error} />
      <div className={styles.tabs} role="tablist">
        {([["pipeline", "Pipeline"], ["contacts", `Contacts (${contacts.length})`], ["companies", `Companies (${companies.length})`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => choose(k)}>{l}</button>
        ))}
      </div>
      {tab === "pipeline" && pipelines.length > 0 && <Board pipelines={pipelines} contacts={contacts} companies={companies} businesses={businesses} onChanged={load} onError={setError} />}
      {tab === "contacts" && <Contacts contacts={contacts} companies={companies} businesses={businesses} onChanged={load} onError={setError} />}
      {tab === "companies" && <Companies companies={companies} contacts={contacts} onChanged={load} onError={setError} />}
    </section>
  );
}

function Board({ pipelines, contacts, companies, businesses, onChanged, onError }: {
  pipelines: Pipeline[]; contacts: Contact[]; companies: Company[]; businesses: Business[]; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [pid, setPid] = useState(pipelines[0].id);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const pipeline = pipelines.find((p) => p.id === pid) || pipelines[0];
  const today = officeToday();
  const contactById = useMemo(() => new Map(contacts.map((c) => [c.id, c])), [contacts]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  useEffect(() => { try { const p = localStorage.getItem("office.crm.pipeline"); if (p && pipelines.some((x) => x.id === p)) setPid(p); } catch { /* ignore */ } }, [pipelines]);
  const load = useCallback(async () => {
    try { setDeals(await officeRest<Deal[]>(`office_deals?pipeline_id=eq.${pid}${showClosed ? "" : "&or=(status.eq.open,closed_at.gte." + new Date(Date.now() - 30 * 86_400_000).toISOString() + ")"}&select=${DEAL_SELECT}&order=updated_at.desc&limit=500`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load deals."); }
  }, [pid, showClosed, onError]);
  useEffect(() => { void load(); }, [load]);

  const move = async (d: Deal, dir: -1 | 1) => {
    const i = pipeline.stages.findIndex((s) => s.key === d.stage);
    const next = pipeline.stages[i + dir];
    if (!next) return;
    try { await officePatch("office_deals", `id=eq.${d.id}`, { stage: next.key }); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not move the deal."); }
  };
  const openValue = deals.filter((d) => d.status === "open").reduce((n, d) => n + Number(d.value_cents), 0);

  return (
    <>
      <div className={styles.toolbar} style={{ marginTop: 0 }}>
        <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
          <label className={styles.field} style={{ minWidth: 240 }}>Pipeline
            <select value={pid} onChange={(e) => { setPid(e.target.value); try { localStorage.setItem("office.crm.pipeline", e.target.value); } catch { /* ignore */ } }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{(businesses.find((b) => b.id === p.business_id)?.name || "General")} · {p.name}</option>)}
            </select>
          </label>
          <label className={styles.check} style={{ margin: "22px 0 0" }}><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show all closed deals</label>
        </div>
        <div className={styles.rowActions}>
          <strong>{money(openValue)} open</strong>
          {!adding && <button className="button button-primary" onClick={() => setAdding(true)}>+ New deal</button>}
        </div>
      </div>
      {adding && <NewDeal pipeline={pipeline} contacts={contacts} companies={companies} onDone={async (id) => { setAdding(false); if (id) window.location.assign(`/office/crm/deals/${id}`); else { await onChanged(); await load(); } }} onCancel={() => setAdding(false)} onError={onError} />}
      <div className={styles.kanban}>
        {pipeline.stages.map((s, si) => {
          const col = deals.filter((d) => d.stage === s.key);
          return (
            <div key={s.key} className={`${styles.kanbanCol} ${s.kind !== "open" ? styles[`kanban_${s.kind}`] : ""}`}>
              <div className={styles.kanbanHead}><strong>{s.label}</strong><small>{col.length} · {money(col.reduce((n, d) => n + Number(d.value_cents), 0))}</small></div>
              {col.map((d) => {
                const c = d.contact_id ? contactById.get(d.contact_id) : undefined;
                const late = d.status === "open" && d.next_step_on && d.next_step_on <= today;
                return (
                  <article key={d.id} className={styles.dealCard}>
                    <a href={`/office/crm/deals/${d.id}`}><strong>{d.title}</strong></a>
                    <small className={styles.muted}>{[d.company_id ? companyById.get(d.company_id)?.name : null, c?.name].filter(Boolean).join(" · ")}</small>
                    {Number(d.value_cents) > 0 && <small>{money(d.value_cents)}{Number(d.recurring_cents) > 0 ? ` + ${money(d.recurring_cents)}/mo` : ""}</small>}
                    {d.next_step && d.status === "open" && <small className={late ? styles.overdue : styles.muted}>Next: {d.next_step}{d.next_step_on ? ` · ${prettyDate(d.next_step_on)}` : ""}</small>}
                    <div className={styles.dealMove}>
                      <button type="button" disabled={si === 0} aria-label={`Move ${d.title} back`} onClick={() => void move(d, -1)}>←</button>
                      <button type="button" disabled={si === pipeline.stages.length - 1} aria-label={`Move ${d.title} forward`} onClick={() => void move(d, 1)}>→</button>
                    </div>
                  </article>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

function NewDeal({ pipeline, contacts, companies, onDone, onCancel, onError }: {
  pipeline: Pipeline; contacts: Contact[]; companies: Company[]; onDone: (id?: string) => Promise<void>; onCancel: () => void; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [contact, setContact] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [value, setValue] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [nextOn, setNextOn] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      let cid = contact || null;
      if (contact === "new") {
        if (!newName.trim()) return onError("Enter the new contact's name.");
        cid = (await officeInsert<Contact>("office_contacts", { name: newName.trim(), email: newEmail.trim() || null, source: "manual" })).id;
      }
      const c = contacts.find((x) => x.id === cid);
      const d = await officeInsert<Deal>("office_deals", {
        pipeline_id: pipeline.id, title: title.trim(), contact_id: cid, company_id: c?.company_id ?? null, stage: pipeline.stages[0].key,
        value_cents: toCents(value) || 0, next_step: nextStep.trim() || null, next_step_on: nextOn || null, source: "manual",
      });
      await onDone(d.id);
    } catch (err) { onError(err instanceof Error ? err.message : "Could not create the deal."); }
  }
  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={save}>
      <div className={styles.formGrid4}>
        <label className={`${styles.field} ${styles.span2}`}>Deal<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Wilmington cemetery layout pilot" required /></label>
        <label className={styles.field}>Contact
          <select value={contact} onChange={(e) => setContact(e.target.value)}>
            <option value="">None yet</option>
            <option value="new">+ New contact…</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company_id ? ` (${companies.find((x) => x.id === c.company_id)?.name})` : ""}</option>)}
          </select>
        </label>
        <label className={styles.field}>Value ($)<input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="5000" /></label>
        {contact === "new" && <label className={styles.field}>Name<input value={newName} onChange={(e) => setNewName(e.target.value)} /></label>}
        {contact === "new" && <label className={styles.field}>Email<input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label>}
        <label className={`${styles.field} ${contact === "new" ? "" : styles.span2}`}>Next step<input value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="Discovery call" /></label>
        <label className={styles.field}>By<input type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} /></label>
      </div>
      <div className={styles.rowEnd}><button type="button" className={styles.linkButton} onClick={onCancel}>Cancel</button><button className="button button-primary" type="submit">Create deal</button></div>
    </form>
  );
}

function Contacts({ contacts, companies, businesses, onChanged, onError }: { contacts: Contact[]; companies: Company[]; businesses: Business[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [biz, setBiz] = useState("");
  const [tags, setTags] = useState<ContactBusiness[]>([]);
  const [f, setF] = useState({ name: "", email: "", phone: "", company: "", business: "" });
  useEffect(() => { officeRest<ContactBusiness[]>("office_contact_businesses?select=contact_id,business_id,role&limit=5000").then(setTags, () => setTags([])); }, [contacts]);
  const companyName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name : "") || "";
  const shown = contacts.filter((c) => (!q || `${c.name} ${c.email || ""} ${companyName(c.company_id)}`.toLowerCase().includes(q.toLowerCase())) && (!biz || tags.some((t) => t.contact_id === c.id && t.business_id === biz)));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      let companyId: string | null = null;
      if (f.company.trim()) companyId = companies.find((c) => c.name.toLowerCase() === f.company.trim().toLowerCase())?.id || (await officeInsert<Company>("office_companies", { name: f.company.trim() })).id;
      const c = await officeInsert<Contact>("office_contacts", { name: f.name.trim(), email: f.email.trim() || null, phone: f.phone.trim() || null, company_id: companyId, source: "manual" });
      if (f.business) await officeInsert("office_contact_businesses", { contact_id: c.id, business_id: f.business, role: "prospect" });
      setF({ name: "", email: "", phone: "", company: "", business: "" });
      await onChanged();
    } catch (err) { onError(err instanceof Error ? (err.message.includes("office_contacts_email_key") ? "A contact with that email already exists." : err.message) : "Could not add the contact."); }
  }
  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></label>
          <label className={styles.field}>Email<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className={styles.field}>Phone<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className={styles.field}>Company<input list="crm-companies" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
          <datalist id="crm-companies">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <BusinessSelect businesses={businesses} value={f.business} onChange={(v) => setF({ ...f, business: v })} label="Interested in" noneLabel="—" />
        </div>
        <div className={styles.rowEnd}><button className="button button-primary" type="submit">Add contact</button></div>
      </form>
      <div className={styles.toolbar}>
        <label className={styles.field} style={{ minWidth: 260 }}><span className={styles.srOnly}>Search</span><input type="search" placeholder="Search name, email, company…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <div className={styles.toolbarField}><BusinessSelect businesses={businesses} value={biz} onChange={setBiz} noneLabel="All businesses" label="Filter" /></div>
      </div>
      {shown.length === 0 && <p className={styles.muted}>No contacts.</p>}
      {shown.length > 0 && (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Businesses</th><th>Last contact</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={styles.rowLink} onClick={() => window.location.assign(`/office/crm/contacts/${c.id}`)}>
                  <td><a href={`/office/crm/contacts/${c.id}`}><strong>{c.name}</strong></a>{c.title && <div><small className={styles.muted}>{c.title}</small></div>}</td>
                  <td>{companyName(c.company_id)}</td>
                  <td>{c.email}</td>
                  <td><span className={styles.taskMeta}>{tags.filter((t) => t.contact_id === c.id).map((t) => <BizTag key={t.business_id} business={businesses.find((b) => b.id === t.business_id)} />)}</span></td>
                  <td>{c.last_contacted_at ? prettyDate(c.last_contacted_at.slice(0, 10)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Companies({ companies, contacts, onChanged, onError }: { companies: Company[]; contacts: Contact[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    try { await officeInsert("office_companies", { name: name.trim(), website: website.trim() || null }); setName(""); setWebsite(""); await onChanged(); }
    catch (err) { onError(err instanceof Error ? err.message : "Could not add the company."); }
  }
  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <label className={`${styles.field} ${styles.span2}`}>Company<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
          <label className={styles.field}>Website<input type="url" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" /></label>
          <div className={styles.rowEnd} style={{ alignSelf: "end" }}><button className="button button-primary" type="submit">Add company</button></div>
        </div>
      </form>
      <ul className={styles.feedList}>
        {companies.map((co) => {
          const people = contacts.filter((c) => c.company_id === co.id);
          return (
            <li key={co.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h3>{co.name}</h3>
                  <span className={styles.taskMeta}>
                    {co.website && /^https?:\/\//i.test(co.website) && <a className={styles.smallLink} href={co.website} target="_blank" rel="noopener noreferrer">{co.website.replace(/^https?:\/\//, "")}</a>}
                    {people.map((p) => <a key={p.id} className={styles.smallLink} href={`/office/crm/contacts/${p.id}`}>{p.name}</a>)}
                  </span>
                </div>
                {co.bill_customer_id && <span className={styles.pill}>Billing customer</span>}
              </div>
              {editing === co.id ? (
                <>
                  <textarea rows={3} className={styles.copyBox} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <div className={styles.rowEnd}><button type="button" className={styles.linkButton} onClick={() => setEditing(null)}>Cancel</button><button type="button" className="button button-primary" onClick={async () => { await officePatch("office_companies", `id=eq.${co.id}`, { notes: notes.trim() || null }); setEditing(null); await onChanged(); }}>Save notes</button></div>
                </>
              ) : (
                <>
                  {co.notes && <p>{co.notes}</p>}
                  <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}><button type="button" className={styles.linkButton} onClick={() => { setEditing(co.id); setNotes(co.notes || ""); }}>{co.notes ? "Edit notes" : "Add notes"}</button></div>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
