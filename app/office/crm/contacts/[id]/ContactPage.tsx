"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../../../components";
import { useBusinesses } from "../../../useBusinesses";
import { officeDelete, officeInsert, officePatch, officeRest } from "../../../lib/client";
import { Timeline } from "../../Timeline";
import { CONTACT_SELECT, DEAL_SELECT, money, type Company, type Contact, type ContactBusiness, type Deal, type Pipeline } from "../../types";

export default function ContactPage({ id }: { id: string }) {
  const { businesses } = useBusinesses();
  const [contact, setContact] = useState<Contact | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [tags, setTags] = useState<ContactBusiness[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [f, setF] = useState({ name: "", email: "", phone: "", title: "", company: "", notes: "" });
  const [newTag, setNewTag] = useState({ business: "", role: "prospect" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const [c, co, t, d, p] = await Promise.all([
        officeRest<Contact[]>(`office_contacts?id=eq.${id}&select=${CONTACT_SELECT}&limit=1`),
        officeRest<Company[]>("office_companies?select=id,name,website,phone,notes,bill_customer_id&order=name.asc&limit=1000"),
        officeRest<ContactBusiness[]>(`office_contact_businesses?contact_id=eq.${id}&select=contact_id,business_id,role`),
        officeRest<Deal[]>(`office_deals?contact_id=eq.${id}&select=${DEAL_SELECT}&order=created_at.desc`),
        officeRest<Pipeline[]>("office_pipelines?select=id,business_id,name,stages,sort_order"),
      ]);
      if (!c[0]) { setError("Contact not found."); return; }
      setContact(c[0]); setCompanies(co); setTags(t); setDeals(d); setPipelines(p);
      setF({ name: c[0].name, email: c[0].email || "", phone: c[0].phone || "", title: c[0].title || "", company: co.find((x) => x.id === c[0].company_id)?.name || "", notes: c[0].notes || "" });
      setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the contact."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setDirty(true); };
  async function save() {
    if (!contact) return;
    try {
      let companyId: string | null = null;
      if (f.company.trim()) companyId = companies.find((c) => c.name.toLowerCase() === f.company.trim().toLowerCase())?.id || (await officeInsert<Company>("office_companies", { name: f.company.trim() })).id;
      await officePatch("office_contacts", `id=eq.${contact.id}`, { name: f.name.trim(), email: f.email.trim() || null, phone: f.phone.trim() || null, title: f.title.trim() || null, company_id: companyId, notes: f.notes.trim() || null });
      setMsg("Saved.");
      await load();
    } catch (e) { setError(e instanceof Error ? (e.message.includes("office_contacts_email_key") ? "Another contact already has that email." : e.message) : "Could not save."); }
  }
  async function addTag() {
    if (!contact || !newTag.business) return;
    try {
      await officeRest("office_contact_businesses?on_conflict=contact_id,business_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ contact_id: contact.id, business_id: newTag.business, role: newTag.role }) });
      setNewTag({ business: "", role: "prospect" });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add."); }
  }

  if (!contact) return <section className={styles.page}><ErrorBox message={error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <a className={styles.smallLink} href="/office/crm">← CRM</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div>
          <span className="product-tag">Contact</span>
          <h1>{contact.name}</h1>
          <p>{[contact.title, f.company, contact.email, contact.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className={styles.headerActions}><button className="button button-primary" disabled={!dirty} onClick={() => void save()}>Save</button></div>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={styles.twoCol} style={{ marginTop: 0 }}>
        <div className={styles.stack}>
          <article className={styles.card}>
            <div className={styles.formGrid}>
              <label className={styles.field}>Name<input value={f.name} onChange={(e) => set({ name: e.target.value })} /></label>
              <label className={styles.field}>Title<input value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder="County manager" /></label>
              <label className={styles.field}>Email<input type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} /></label>
              <label className={styles.field}>Phone<input value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>Company<input list="contact-companies" value={f.company} onChange={(e) => set({ company: e.target.value })} /></label>
              <datalist id="contact-companies">{companies.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              <label className={styles.field} style={{ gridColumn: "1 / -1" }}>Notes<textarea rows={3} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
            </div>
          </article>

          <article className={styles.card}>
            <h2>Businesses</h2>
            <ul className={styles.plainList}>
              {tags.length === 0 && <li className={styles.muted}>Not tagged to a business yet.</li>}
              {tags.map((t) => (
                <li key={t.business_id} className={styles.reminderRow}>
                  <span className={styles.taskMeta}><BizTag business={businesses.find((b) => b.id === t.business_id)} /><small className={styles.muted}>{t.role}</small></span>
                  <button type="button" className={styles.linkButton} onClick={async () => { await officeRest(`office_contact_businesses?contact_id=eq.${contact.id}&business_id=eq.${t.business_id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); await load(); }}>Remove</button>
                </li>
              ))}
            </ul>
            <div className={styles.formGrid4}>
              <div className={styles.span2}><BusinessSelect businesses={businesses} value={newTag.business} onChange={(v) => setNewTag({ ...newTag, business: v })} label="Add business" noneLabel="Choose…" /></div>
              <label className={styles.field}>As
                <select value={newTag.role} onChange={(e) => setNewTag({ ...newTag, role: e.target.value })}>
                  {["lead", "prospect", "client", "partner", "vendor", "other"].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <div style={{ alignSelf: "end" }}><button type="button" className="button button-secondary" disabled={!newTag.business} onClick={() => void addTag()}>Add</button></div>
            </div>
          </article>

          <article className={styles.card}>
            <h2>Deals</h2>
            {deals.length === 0 && <p className={styles.muted}>No deals. Create one from the Pipeline.</p>}
            <ul className={styles.plainList}>
              {deals.map((d) => {
                const p = pipelines.find((x) => x.id === d.pipeline_id);
                return (
                  <li key={d.id} className={styles.reminderRow}>
                    <div><a href={`/office/crm/deals/${d.id}`}><strong>{d.title}</strong></a><small className={styles.muted}>{p?.stages.find((s) => s.key === d.stage)?.label} · {money(d.value_cents)}</small></div>
                    <BizTag business={businesses.find((b) => b.id === d.business_id)} />
                  </li>
                );
              })}
            </ul>
          </article>
          <button type="button" className={styles.linkButton} style={{ justifySelf: "start" }} onClick={async () => { if (!window.confirm(`Delete ${contact.name} and their timeline? Deals stay, without a contact.`)) return; try { await officeDelete("office_contacts", contact.id); window.location.assign("/office/crm"); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); } }}>Delete contact</button>
        </div>
        <div className={styles.stack}>
          <Timeline contact={contact} onError={setError} />
        </div>
      </div>
    </section>
  );
}
