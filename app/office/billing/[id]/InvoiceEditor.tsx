"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../office.module.css";
import { BusinessSelect, ErrorBox } from "../../components";
import { useBusinesses } from "../../useBusinesses";
import { api } from "../../../factory/connections/session";
import { officeDelete, officeInsert, officePatch, officeRest, officeRpc, officeToday, shiftDate } from "../../lib/client";
import {
  CUSTOMER_SELECT, dollars, INVOICE_SELECT, money, payUrl, PRODUCT_SELECT, STATUS_LABEL, toCents,
  type Customer, type Invoice, type Line, type Payment, type Product,
} from "../types";

type DraftLine = { key: string; product_id: string | null; description: string; quantity: string; price: string };
type SendResult = { sent: boolean; via: "gmail" | "resend" | null; link: string; subject: string; text: string };
let keySeq = 0;

type LineRow = { product_id: string | null; description: string; quantity: number; unit_price_cents: number | null };
/** One-transaction line replace (phase 4 SQL); falls back to delete + insert before that is installed. */
async function replaceLines(invoiceId: string, { p_lines }: { p_lines: LineRow[] }) {
  try {
    await officeRpc("bill_replace_lines", { p_invoice: invoiceId, p_lines });
  } catch (e) {
    if ((e as { code?: string }).code !== "PGRST202") throw e;
    await officeRest(`bill_invoice_lines?invoice_id=eq.${invoiceId}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    if (p_lines.length) await officeRest("bill_invoice_lines", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(p_lines.map((l, i) => ({ ...l, invoice_id: invoiceId, sort_order: i }))) });
  }
}
const toDraft = (l: Line): DraftLine => ({ key: `k${keySeq++}`, product_id: l.product_id, description: l.description, quantity: String(Number(l.quantity)), price: dollars(l.unit_price_cents) });

export default function InvoiceEditor({ id }: { id: string }) {
  const { businesses, error: bizError } = useBusinesses();
  const [inv, setInv] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [fields, setFields] = useState({ customer_id: "", business_id: "", issue_date: "", due_date: "", memo: "", tax: "0.00" });
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [i, l, p, c, pr] = await Promise.all([
        officeRest<Invoice[]>(`bill_invoices?id=eq.${id}&select=${INVOICE_SELECT}&limit=1`),
        officeRest<Line[]>(`bill_invoice_lines?invoice_id=eq.${id}&select=id,product_id,description,quantity,unit_price_cents,amount_cents,sort_order&order=sort_order.asc`),
        officeRest<Payment[]>(`bill_payments?invoice_id=eq.${id}&select=id,amount_cents,method,received_on,reference,notes&order=received_on.asc`),
        officeRest<Customer[]>(`bill_customers?select=${CUSTOMER_SELECT}&order=name.asc`),
        officeRest<Product[]>(`bill_products?active=eq.true&select=${PRODUCT_SELECT}&order=name.asc`),
      ]);
      if (!i[0]) { setError("Invoice not found."); return; }
      setInv(i[0]);
      setLines(l.map(toDraft));
      setPayments(p);
      setCustomers(c);
      setProducts(pr);
      setFields({ customer_id: i[0].customer_id, business_id: i[0].business_id || "", issue_date: i[0].issue_date, due_date: i[0].due_date || "", memo: i[0].memo || "", tax: dollars(i[0].tax_cents) });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the invoice.");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const editable = inv ? ["draft", "sent"].includes(inv.status) && payments.length === 0 : false;
  const subtotal = useMemo(() => lines.reduce((n, l) => n + Math.round((Number(l.quantity) || 0) * (toCents(l.price) || 0)), 0), [lines]);
  const tax = toCents(fields.tax) || 0;
  const customer = customers.find((c) => c.id === fields.customer_id);
  const isQuote = inv?.kind === "quote";

  const change = (patch: Partial<typeof fields>) => { setFields({ ...fields, ...patch }); setDirty(true); };
  const changeLine = (key: string, patch: Partial<DraftLine>) => { setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l))); setDirty(true); };
  const addProduct = (pid: string) => {
    const p = products.find((x) => x.id === pid);
    if (!p) return;
    setLines([...lines, { key: `k${keySeq++}`, product_id: p.id, description: p.description ? `${p.name} — ${p.description}` : p.name, quantity: "1", price: dollars(p.unit_price_cents) }]);
    if (!fields.business_id && p.business_id) setFields({ ...fields, business_id: p.business_id });
    setDirty(true);
  };

  async function save(): Promise<boolean> {
    if (!inv) return false;
    for (const l of lines) {
      if (!l.description.trim()) { setError("Every line needs a description."); return false; }
      if (!(Number(l.quantity) > 0) || toCents(l.price) === null) { setError(`Check the quantity and price on “${l.description}”.`); return false; }
    }
    setBusy("save");
    setError("");
    try {
      await officePatch("bill_invoices", `id=eq.${inv.id}`, {
        customer_id: fields.customer_id, business_id: fields.business_id || null, issue_date: fields.issue_date,
        due_date: fields.due_date || null, memo: fields.memo.trim() || null, tax_cents: tax,
      });
      // Replace the lines in one transaction; totals and the books are updated by the database.
      await replaceLines(inv.id, {
        p_lines: lines.map((l) => ({ product_id: l.product_id, description: l.description.trim(), quantity: Number(l.quantity), unit_price_cents: toCents(l.price) })),
      });
      await load();
      setMsg("Saved.");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function send(mode: "send" | "reminder") {
    if (dirty && !(await save())) return;
    setBusy(mode);
    setMsg("");
    setSendResult(null);
    try {
      const r = await api<SendResult>("/api/office/billing/send", { method: "POST", body: JSON.stringify({ invoice_id: id, mode }) });
      setSendResult(r);
      setMsg(r.sent ? `Emailed to ${customer?.email} from ${r.via === "gmail" ? "your Gmail" : "Resend"}.` : "Email isn't set up, so nothing was sent. Copy the message below, or connect Gmail under Factory → Connections.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send.");
    } finally {
      setBusy("");
    }
  }

  async function setStatus(status: Invoice["status"], extra: object = {}) {
    if (!inv) return;
    try { await officePatch("bill_invoices", `id=eq.${inv.id}`, { status, ...extra }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update."); }
  }

  async function convert() {
    if (!inv) return;
    setBusy("convert");
    try {
      const today = officeToday();
      const n = await officeInsert<Invoice>("bill_invoices", {
        entity_id: inv.entity_id, customer_id: inv.customer_id, business_id: inv.business_id, kind: "invoice", issue_date: today,
        due_date: shiftDate(today, 15), memo: inv.memo, tax_cents: inv.tax_cents, converted_from: inv.id,
      });
      if (lines.length) {
        await replaceLines(n.id, { p_lines: lines.map((l) => ({ product_id: l.product_id, description: l.description, quantity: Number(l.quantity), unit_price_cents: toCents(l.price) })) });
      }
      if (inv.status !== "accepted") await officePatch("bill_invoices", `id=eq.${inv.id}`, { status: "accepted" });
      window.location.assign(`/office/billing/${n.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the invoice.");
      setBusy("");
    }
  }

  if (!inv) return <section className={styles.page}><ErrorBox message={bizError || error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;
  const link = payUrl(inv.public_token);

  return (
    <section className={styles.page}>
      <a className={styles.smallLink} href="/office/billing">← All {isQuote ? "quotes" : "invoices"}</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div>
          <span className="product-tag">{isQuote ? "Quote" : "Invoice"}</span>
          <h1>{inv.number}</h1>
          <p><span className={`${styles.statusPill} ${styles[`st_${inv.status}`] || ""}`}>{STATUS_LABEL[inv.status]}</span>{" "}
            {money(inv.total_cents)}{!isQuote && inv.paid_cents > 0 && ` · paid ${money(inv.paid_cents)} · balance ${money(inv.balance_cents)}`}</p>
        </div>
        <div className={styles.headerActions}>
          {inv.status !== "draft" && <a className="button button-secondary" href={link} target="_blank" rel="noopener noreferrer">View as customer</a>}
          {editable && <button className="button button-primary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>}
        </div>
      </header>
      <ErrorBox message={bizError || error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}
      {sendResult && !sendResult.sent && (
        <div className={styles.card} style={{ marginBottom: 16 }}>
          <strong>Message to send yourself</strong>
          <small className={styles.muted}>Subject: {sendResult.subject}</small>
          <textarea readOnly rows={10} value={sendResult.text} className={styles.copyBox} onFocus={(e) => e.currentTarget.select()} />
          <div className={styles.rowEnd}>
            <button type="button" className="button button-secondary" onClick={() => void navigator.clipboard?.writeText(sendResult.text)}>Copy message</button>
            {inv.status === "draft" && <button type="button" className="button button-primary" onClick={() => void setStatus("sent", { sent_at: new Date().toISOString() })}>Mark as sent</button>}
          </div>
        </div>
      )}

      <div className={styles.card}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Customer
            <select value={fields.customer_id} disabled={!editable} onChange={(e) => change({ customer_id: e.target.value })}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? "" : " (archived)"}</option>)}
            </select>
          </label>
          <BusinessSelect businesses={businesses} value={fields.business_id} onChange={(v) => change({ business_id: v })} disabled={!editable} label="Business line" noneLabel="AI Real Solutions (general)" />
          <label className={styles.field}>Issued<input type="date" value={fields.issue_date} disabled={!editable} onChange={(e) => change({ issue_date: e.target.value })} /></label>
          <label className={styles.field}>{isQuote ? "Valid until" : "Due"}<input type="date" value={fields.due_date} disabled={!editable} onChange={(e) => change({ due_date: e.target.value })} /></label>
        </div>
        {!customer?.email && <small className={styles.overdue}>This customer has no email address yet; add one on the Customers tab to send.</small>}

        <div className={styles.tableWrap}>
          <table className={`${styles.table} ${styles.linesTable}`}>
            <thead><tr><th>Description</th><th className={styles.num}>Qty</th><th className={styles.num}>Price ($)</th><th className={styles.num}>Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td><input value={l.description} disabled={!editable} onChange={(e) => changeLine(l.key, { description: e.target.value })} aria-label="Description" /></td>
                  <td className={styles.num}><input className={styles.qty} inputMode="decimal" value={l.quantity} disabled={!editable} onChange={(e) => changeLine(l.key, { quantity: e.target.value })} aria-label="Quantity" /></td>
                  <td className={styles.num}><input className={styles.price} inputMode="decimal" value={l.price} disabled={!editable} onChange={(e) => changeLine(l.key, { price: e.target.value })} aria-label="Unit price" /></td>
                  <td className={styles.num}>{money(Math.round((Number(l.quantity) || 0) * (toCents(l.price) || 0)))}</td>
                  <td>{editable && <button type="button" className={styles.iconButton} aria-label="Remove line" onClick={() => { setLines(lines.filter((x) => x.key !== l.key)); setDirty(true); }}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={3} className={styles.num}>Subtotal</td><td className={styles.num}>{money(subtotal)}</td><td /></tr>
              <tr><td colSpan={3} className={styles.num}>Tax ($)</td><td className={styles.num}><input className={styles.price} inputMode="decimal" value={fields.tax} disabled={!editable} onChange={(e) => change({ tax: e.target.value })} aria-label="Tax" /></td><td /></tr>
              <tr className={styles.totalRow}><td colSpan={3} className={styles.num}>Total</td><td className={styles.num}>{money(subtotal + tax)}</td><td /></tr>
            </tfoot>
          </table>
        </div>
        {editable && (
          <div className={styles.formGrid4}>
            <label className={`${styles.field} ${styles.span2}`}>Add from price list
              <select value="" onChange={(e) => addProduct(e.target.value)}>
                <option value="">Choose a product…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.unit_price_cents)}/{p.unit}</option>)}
              </select>
            </label>
            <div style={{ alignSelf: "end" }}>
              <button type="button" className="button button-secondary" onClick={() => { setLines([...lines, { key: `k${keySeq++}`, product_id: null, description: "", quantity: "1", price: "0.00" }]); setDirty(true); }}>+ Custom line</button>
            </div>
          </div>
        )}
        <label className={styles.field}>Note to customer<textarea rows={2} value={fields.memo} disabled={!editable} onChange={(e) => change({ memo: e.target.value })} placeholder="Thanks for the project! Net 15." /></label>
        {!editable && payments.length > 0 && inv.status !== "void" && <small className={styles.muted}>Lines are locked because payments have been recorded.</small>}
      </div>

      <div className={styles.twoCol}>
        <article className={styles.card}>
          <h2>Send</h2>
          {inv.status === "draft" && <p className={styles.muted}>Emails the customer a summary and a link to {isQuote ? "view and accept" : "view and pay"} online.</p>}
          <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
            {(inv.status === "draft" || inv.status === "sent") && (
              <button className="button button-primary" disabled={!!busy || !lines.length} onClick={() => void send("send")}>{busy === "send" ? "Sending…" : inv.status === "draft" ? `Send ${isQuote ? "quote" : "invoice"}` : "Send again"}</button>
            )}
            {!isQuote && (inv.status === "sent" || inv.status === "partial") && (
              <button className="button button-secondary" disabled={!!busy} onClick={() => void send("reminder")}>{busy === "reminder" ? "Sending…" : "Send payment reminder"}</button>
            )}
            {inv.status !== "draft" && <button type="button" className={styles.linkButton} onClick={() => { void navigator.clipboard?.writeText(link); setMsg("Pay link copied."); }}>Copy {isQuote ? "quote" : "pay"} link</button>}
          </div>
          {isQuote && (
            <div className={styles.rowActions} style={{ justifyContent: "flex-start", marginTop: 8 }}>
              {(inv.status === "sent" || inv.status === "accepted") && <button className="button button-primary" disabled={!!busy} onClick={() => void convert()}>{busy === "convert" ? "Creating…" : "Turn into invoice"}</button>}
              {inv.status === "sent" && <button type="button" className={styles.linkButton} onClick={() => void setStatus("declined")}>Mark declined</button>}
            </div>
          )}
          <div className={styles.rowActions} style={{ justifyContent: "flex-start", marginTop: 12 }}>
            {inv.status === "draft" && <button type="button" className={styles.linkButton} onClick={async () => { if (window.confirm(`Delete draft ${inv.number}?`)) { await officeDelete("bill_invoices", inv.id); window.location.assign("/office/billing"); } }}>Delete draft</button>}
            {!isQuote && inv.status !== "void" && inv.status !== "draft" && payments.length === 0 && (
              <button type="button" className={styles.linkButton} onClick={() => { if (window.confirm(`Void ${inv.number}? It stays on record but can't be paid.`)) void setStatus("void", { voided_at: new Date().toISOString() }); }}>Void invoice</button>
            )}
          </div>
        </article>

        {!isQuote && <Payments inv={inv} payments={payments} onChanged={load} onError={setError} />}
      </div>
    </section>
  );
}

function Payments({ inv, payments, onChanged, onError }: { inv: Invoice; payments: Payment[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [amount, setAmount] = useState(dollars(inv.balance_cents));
  const [method, setMethod] = useState("check");
  const [date, setDate] = useState(officeToday());
  const [reference, setReference] = useState("");
  useEffect(() => setAmount(dollars(Math.max(0, inv.balance_cents))), [inv.balance_cents]);
  const canRecord = inv.status === "sent" || inv.status === "partial";

  async function record(e: React.FormEvent) {
    e.preventDefault();
    const cents = toCents(amount);
    if (!cents) return onError("Enter the amount received.");
    if (cents > inv.balance_cents && !window.confirm(`That's more than the ${money(inv.balance_cents)} balance. Record it anyway?`)) return;
    try {
      await officeInsert("bill_payments", { entity_id: inv.entity_id, invoice_id: inv.id, customer_id: inv.customer_id, amount_cents: cents, method, received_on: date, reference: reference.trim() || null });
      setReference("");
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not record the payment.");
    }
  }
  return (
    <article className={styles.card}>
      <h2>Payments</h2>
      {payments.length === 0 && <p className={styles.muted}>None yet. Stripe payments appear here on their own.</p>}
      <ul className={styles.plainList}>
        {payments.map((p) => (
          <li key={p.id} className={styles.reminderRow}>
            <div><strong>{money(p.amount_cents)}</strong><small className={styles.muted}>{p.method} · {p.received_on}{p.reference ? ` · ${p.reference}` : ""}</small></div>
            {p.method !== "stripe" && <button type="button" className={styles.linkButton} onClick={async () => { if (window.confirm("Remove this payment record?")) { await officeDelete("bill_payments", p.id); await onChanged(); } }}>Remove</button>}
          </li>
        ))}
      </ul>
      {canRecord && (
        <form onSubmit={record} className={styles.formGrid} style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          <label className={styles.field}>Amount ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
          <label className={styles.field}>Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="check">Check</option><option value="ach">Bank transfer (ACH)</option><option value="wire">Wire</option><option value="cash">Cash</option><option value="other">Other</option>
            </select>
          </label>
          <label className={styles.field}>Received<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label className={styles.field}>Reference<input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check #1042" /></label>
          <div className={styles.rowEnd} style={{ gridColumn: "1 / -1" }}><button className="button button-primary" type="submit">Record payment</button></div>
        </form>
      )}
    </article>
  );
}
