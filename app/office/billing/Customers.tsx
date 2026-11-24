"use client";

import { useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect } from "../components";
import { officeInsert, officePatch, type Business } from "../lib/client";
import { money, type Customer, type Invoice } from "./types";

const EMPTY = { name: "", email: "", phone: "", billing_address: "", notes: "", business_id: "" };

export function Customers({ customers, businesses, entityId, invoices, onChanged, onError }: {
  customers: Customer[]; businesses: Business[]; entityId: string; invoices: Invoice[]; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [showInactive, setShowInactive] = useState(false);
  const owed = (id: string) => invoices.filter((i) => i.customer_id === id && i.kind === "invoice" && (i.status === "sent" || i.status === "partial")).reduce((n, i) => n + Number(i.balance_cents), 0);
  const billed = (id: string) => invoices.filter((i) => i.customer_id === id && i.kind === "invoice" && i.status !== "void" && i.status !== "draft").reduce((n, i) => n + Number(i.total_cents), 0);

  const start = (c?: Customer) => {
    setEditing(c ? c.id : "new");
    setForm(c ? { name: c.name, email: c.email || "", phone: c.phone || "", billing_address: c.billing_address || "", notes: c.notes || "", business_id: c.business_id || "" } : EMPTY);
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    const row = { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, billing_address: form.billing_address.trim() || null, notes: form.notes.trim() || null, business_id: form.business_id || null };
    try {
      if (editing === "new") await officeInsert("bill_customers", { ...row, entity_id: entityId });
      else if (editing) await officePatch("bill_customers", `id=eq.${editing}`, row);
      setEditing(null);
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save the customer.");
    }
  }

  const form_ = (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={save}>
      <h2>{editing === "new" ? "New customer" : "Edit customer"}</h2>
      <div className={styles.formGrid4}>
        <label className={`${styles.field} ${styles.span2}`}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Lightkeeper Realty" /></label>
        <label className={styles.field}>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="billing@…" /></label>
        <label className={styles.field}>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <BusinessSelect businesses={businesses} value={form.business_id} onChange={(v) => setForm({ ...form, business_id: v })} label="Linked business" noneLabel="None" />
        <label className={`${styles.field} ${styles.span2}`}>Billing address<textarea rows={2} value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></label>
        <label className={styles.field}>Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      </div>
      <div className={styles.rowEnd}>
        <button type="button" className={styles.linkButton} onClick={() => setEditing(null)}>Cancel</button>
        <button className="button button-primary" type="submit">Save customer</button>
      </div>
    </form>
  );

  return (
    <>
      {editing ? form_ : <div className={styles.rowEnd} style={{ justifyContent: "space-between" }}>
        <label className={styles.check} style={{ margin: 0 }}><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show archived</label>
        <button className="button button-primary" onClick={() => start()}>+ New customer</button>
      </div>}
      {customers.length === 0 && !editing && <p className={styles.muted}>No customers yet. Add Lightkeeper Realty or your next client.</p>}
      <ul className={styles.feedList}>
        {customers.filter((c) => showInactive || c.active).map((c) => (
          <li key={c.id} className={`${styles.card} ${c.active ? "" : styles.taskDone}`}>
            <div className={styles.cardHead}>
              <div>
                <h3>{c.name}</h3>
                <span className={styles.taskMeta}>
                  <BizTag business={businesses.find((b) => b.id === c.business_id)} />
                  {c.email && <small className={styles.muted}>{c.email}</small>}
                  {c.phone && <small className={styles.muted}>{c.phone}</small>}
                </span>
              </div>
              <div className={styles.right}>
                <strong>{money(owed(c.id))}</strong><small className={styles.muted}> owed</small>
                <div><small className={styles.muted}>{money(billed(c.id))} billed to date</small></div>
              </div>
            </div>
            <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
              <button type="button" className={styles.linkButton} onClick={() => start(c)}>Edit</button>
              <button type="button" className={styles.linkButton} onClick={async () => { await officePatch("bill_customers", `id=eq.${c.id}`, { active: !c.active }); await onChanged(); }}>{c.active ? "Archive" : "Restore"}</button>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
