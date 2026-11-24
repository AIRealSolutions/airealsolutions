"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect } from "../components";
import { officeInsert, officePatch, officeRest, officeToday, prettyDate, type Business } from "../lib/client";
import { money, PRODUCT_SELECT, toCents, type Customer, type Product, type Subscription, type SubLine } from "./types";

export function Recurring({ customers, businesses, entityId, onError }: { customers: Customer[]; businesses: Business[]; entityId: string; onError: (m: string) => void }) {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        officeRest<Subscription[]>("bill_subscriptions?select=*&order=status.asc,next_invoice_on.asc"),
        officeRest<Product[]>(`bill_products?active=eq.true&select=${PRODUCT_SELECT}&order=name.asc`),
      ]);
      setSubs(s);
      setProducts(p);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load recurring billing.");
    }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  const total = (lines: SubLine[]) => lines.reduce((n, l) => n + Math.round(l.quantity * l.unit_price_cents), 0);
  const mrr = subs.filter((s) => s.status === "active").reduce((n, s) => n + (s.interval === "month" ? total(s.lines) : total(s.lines) / 12), 0);
  const setStatus = async (s: Subscription, status: Subscription["status"]) => {
    if (status === "canceled" && !window.confirm(`Cancel “${s.name}”? No more invoices will be created.`)) return;
    try { await officePatch("bill_subscriptions", `id=eq.${s.id}`, { status }); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not update."); }
  };

  return (
    <>
      <div className={styles.rowEnd} style={{ justifyContent: "space-between" }}>
        <p className={styles.muted} style={{ margin: 0 }}>Recurring revenue: <strong>{money(Math.round(mrr))}/month</strong>. The morning job creates each invoice on its date.</p>
        {!adding && <button className="button button-primary" onClick={() => setAdding(true)} disabled={!customers.length}>+ New recurring invoice</button>}
      </div>
      {adding && <NewSubscription customers={customers} products={products} businesses={businesses} entityId={entityId} onDone={async () => { setAdding(false); await load(); }} onCancel={() => setAdding(false)} onError={onError} />}
      {subs.length === 0 && !adding && <p className={styles.muted}>No recurring billing yet. Use it for retainers, hosting and SaaS plans.</p>}
      <ul className={styles.feedList}>
        {subs.map((s) => (
          <li key={s.id} className={`${styles.card} ${s.status === "canceled" ? styles.taskDone : ""}`}>
            <div className={styles.cardHead}>
              <div>
                <h3>{s.name}</h3>
                <span className={styles.taskMeta}>
                  <small className={styles.muted}>{customers.find((c) => c.id === s.customer_id)?.name}</small>
                  <BizTag business={businesses.find((b) => b.id === s.business_id)} />
                  <small className={styles.muted}>{s.status === "active" ? `Next invoice ${prettyDate(s.next_invoice_on)}` : s.status}{s.auto_send ? " · emails itself" : " · you send it"}</small>
                </span>
              </div>
              <div className={styles.right}><strong>{money(total(s.lines))}</strong><small className={styles.muted}> / {s.interval}</small></div>
            </div>
            <ul className={styles.list}>{s.lines.map((l, i) => <li key={i}>{l.description}{l.quantity !== 1 ? ` × ${l.quantity}` : ""}: {money(Math.round(l.quantity * l.unit_price_cents))}</li>)}</ul>
            <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
              {s.status === "active" && <button type="button" className={styles.linkButton} onClick={() => void setStatus(s, "paused")}>Pause</button>}
              {s.status === "paused" && <button type="button" className={styles.linkButton} onClick={() => void setStatus(s, "active")}>Resume</button>}
              {s.status !== "canceled" && <button type="button" className={styles.linkButton} onClick={() => void setStatus(s, "canceled")}>Cancel</button>}
              {s.status !== "canceled" && <button type="button" className={styles.linkButton} onClick={async () => { await officePatch("bill_subscriptions", `id=eq.${s.id}`, { auto_send: !s.auto_send }); await load(); }}>{s.auto_send ? "Stop emailing automatically" : "Email automatically"}</button>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function NewSubscription({ customers, products, businesses, entityId, onDone, onCancel, onError }: {
  customers: Customer[]; products: Product[]; businesses: Business[]; entityId: string; onDone: () => Promise<void>; onCancel: () => void; onError: (m: string) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [business, setBusiness] = useState("");
  const [name, setName] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [next, setNext] = useState(officeToday());
  const [days, setDays] = useState("15");
  const [autoSend, setAutoSend] = useState(false);
  const [lines, setLines] = useState<SubLine[]>([]);
  const [custom, setCustom] = useState({ description: "", amount: "" });

  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (p) { setLines([...lines, { product_id: p.id, description: p.name, quantity: 1, unit_price_cents: p.unit_price_cents }]); if (!name) setName(p.name); if (!business && p.business_id) setBusiness(p.business_id); }
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const all = [...lines];
    const c = toCents(custom.amount);
    if (custom.description.trim() && c !== null) all.push({ product_id: null, description: custom.description.trim(), quantity: 1, unit_price_cents: c });
    if (!customer || !all.length) return onError("Pick a customer and add at least one line.");
    try {
      await officeInsert("bill_subscriptions", {
        entity_id: entityId, customer_id: customer, business_id: business || customers.find((x) => x.id === customer)?.business_id || null,
        name: name.trim() || all[0].description, interval, next_invoice_on: next, days_until_due: Math.max(0, Math.min(120, Number(days) || 0)), lines: all, auto_send: autoSend,
      });
      await onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  }
  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={save}>
      <h2>New recurring invoice</h2>
      <div className={styles.formGrid4}>
        <label className={styles.field}>Customer
          <select value={customer} onChange={(e) => setCustomer(e.target.value)} required>
            <option value="">Choose…</option>
            {customers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={styles.field}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website care plan" /></label>
        <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="Business line" noneLabel="AI Real Solutions (general)" />
        <label className={styles.field}>Every
          <select value={interval} onChange={(e) => setInterval(e.target.value as "month" | "year")}><option value="month">Month</option><option value="year">Year</option></select>
        </label>
        <label className={styles.field}>First invoice on<input type="date" value={next} onChange={(e) => setNext(e.target.value)} required /></label>
        <label className={styles.field}>Due after (days)<input type="number" min={0} max={120} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <label className={`${styles.check} ${styles.span2}`} style={{ alignSelf: "end" }}><input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} /> Email it to the customer automatically (needs Resend)</label>
      </div>
      <strong>Lines</strong>
      <ul className={styles.list}>{lines.map((l, i) => <li key={i}>{l.description}: {money(l.unit_price_cents)} <button type="button" className={styles.linkButton} onClick={() => setLines(lines.filter((_, j) => j !== i))}>remove</button></li>)}</ul>
      <div className={styles.formGrid4}>
        <label className={`${styles.field} ${styles.span2}`}>Add from price list
          <select value="" onChange={(e) => addProduct(e.target.value)}>
            <option value="">Choose a product…</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.unit_price_cents)}</option>)}
          </select>
        </label>
        <label className={styles.field}>Or a custom line<input value={custom.description} onChange={(e) => setCustom({ ...custom, description: e.target.value })} placeholder="Description" /></label>
        <label className={styles.field}>Amount ($)<input inputMode="decimal" value={custom.amount} onChange={(e) => setCustom({ ...custom, amount: e.target.value })} placeholder="99" /></label>
      </div>
      <div className={styles.rowEnd}>
        <button type="button" className={styles.linkButton} onClick={onCancel}>Cancel</button>
        <button className="button button-primary" type="submit">Save recurring invoice</button>
      </div>
    </form>
  );
}
