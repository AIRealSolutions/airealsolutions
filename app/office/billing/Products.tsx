"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect } from "../components";
import { officeInsert, officePatch, officeRest, type Business } from "../lib/client";
import { dollars, money, PRODUCT_SELECT, toCents, type Product } from "./types";

export function Products({ businesses, entityId, onError }: { businesses: Business[]; entityId: string; onError: (m: string) => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("each");
  const [interval, setInterval] = useState("");
  const [business, setBusiness] = useState("");
  const [description, setDescription] = useState("");
  const [editPrice, setEditPrice] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try { setProducts(await officeRest<Product[]>(`bill_products?select=${PRODUCT_SELECT}&order=active.desc,name.asc`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load products."); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const cents = toCents(price);
    if (!name.trim() || cents === null) return onError("Enter a name and a price.");
    try {
      await officeInsert("bill_products", { entity_id: entityId, name: name.trim(), description: description.trim() || null, unit_price_cents: cents, unit, recurring_interval: interval || null, business_id: business || null });
      setName(""); setPrice(""); setDescription("");
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the product.");
    }
  }
  const update = async (p: Product, change: Partial<Product>) => {
    try { await officePatch("bill_products", `id=eq.${p.id}`, change); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not save."); }
  };

  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <label className={`${styles.field} ${styles.span2}`}>Product or service<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Website build — starter" required /></label>
          <label className={styles.field}>Price ($)<input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1500" required /></label>
          <label className={styles.field}>Per
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="each">each</option><option value="hour">hour</option><option value="month">month</option><option value="year">year</option><option value="project">project</option>
            </select>
          </label>
          <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="Earned by" noneLabel="AI Real Solutions (general)" />
          <label className={styles.field}>Billing
            <select value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="">One-time</option><option value="month">Monthly</option><option value="year">Yearly</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.span2}`}>Description (optional)<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
        </div>
        <div className={styles.rowEnd}><button className="button button-primary" type="submit">Add to price list</button></div>
      </form>

      {products.length === 0 && <p className={styles.muted}>No products yet. Add your services (builds, retainers, hosting, hourly work) so invoices fill in with one click.</p>}
      {products.length > 0 && (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>Name</th><th>Earned by</th><th className={styles.num}>Price</th><th>Billing</th><th></th></tr></thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className={p.active ? undefined : styles.taskDone}>
                  <td><strong>{p.name}</strong>{p.description && <div><small className={styles.muted}>{p.description}</small></div>}</td>
                  <td><BizTag business={businesses.find((b) => b.id === p.business_id)} /></td>
                  <td className={styles.num}>
                    {editPrice[p.id] !== undefined ? (
                      <span className={styles.inlineEdit}>
                        <input className={styles.smallInput} value={editPrice[p.id]} onChange={(e) => setEditPrice({ ...editPrice, [p.id]: e.target.value })} aria-label="New price" />
                        <button type="button" className={styles.linkButton} onClick={async () => { const c = toCents(editPrice[p.id]); if (c === null) return onError("Enter a valid price."); await update(p, { unit_price_cents: c }); setEditPrice((v) => { const n = { ...v }; delete n[p.id]; return n; }); }}>Save</button>
                      </span>
                    ) : (
                      <button type="button" className={styles.linkButton} title="Change price" onClick={() => setEditPrice({ ...editPrice, [p.id]: dollars(p.unit_price_cents) })}>{money(p.unit_price_cents)}</button>
                    )} <small className={styles.muted}>/ {p.unit}</small>
                  </td>
                  <td>{p.recurring_interval === "month" ? "Monthly" : p.recurring_interval === "year" ? "Yearly" : "One-time"}</td>
                  <td><button type="button" className={styles.linkButton} onClick={() => void update(p, { active: !p.active })}>{p.active ? "Retire" : "Restore"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
