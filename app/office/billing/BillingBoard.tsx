"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeInsert, officeRest, officeToday, prettyDate, shiftDate } from "../lib/client";
import { Customers } from "./Customers";
import { Products } from "./Products";
import { Recurring } from "./Recurring";
import { BillingSettings } from "./Settings";
import { CUSTOMER_SELECT, INVOICE_SELECT, money, STATUS_LABEL, type Customer, type Invoice } from "./types";

type Tab = "invoices" | "quotes" | "customers" | "products" | "recurring" | "settings";
const TABS: [Tab, string][] = [["invoices", "Invoices"], ["quotes", "Quotes"], ["customers", "Customers"], ["products", "Products & prices"], ["recurring", "Recurring"], ["settings", "Settings"]];

export default function BillingBoard() {
  const { businesses, entities, error: bizError } = useBusinesses();
  const [tab, setTab] = useState<Tab>("invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [paidThisMonth, setPaidThisMonth] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const today = officeToday();

  useEffect(() => {
    try { const t = localStorage.getItem("office.billing.tab") as Tab | null; if (t && TABS.some(([k]) => k === t)) setTab(t); } catch { /* storage unavailable */ }
  }, []);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem("office.billing.tab", t); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    setError("");
    try {
      const [inv, cust, pays] = await Promise.all([
        officeRest<Invoice[]>(`bill_invoices?select=${INVOICE_SELECT}&order=issue_date.desc,number.desc&limit=500`),
        officeRest<Customer[]>(`bill_customers?select=${CUSTOMER_SELECT}&order=name.asc`),
        officeRest<{ amount_cents: number }[]>(`bill_payments?received_on=gte.${today.slice(0, 8)}01&select=amount_cents`),
      ]);
      setInvoices(inv);
      setCustomers(cust);
      setPaidThisMonth(pays.reduce((n, p) => n + Number(p.amount_cents), 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load billing.");
    } finally {
      setLoading(false);
    }
  }, [today]);
  useEffect(() => { void load(); }, [load]);

  const open = invoices.filter((i) => i.kind === "invoice" && (i.status === "sent" || i.status === "partial"));
  const overdue = open.filter((i) => i.due_date && i.due_date < today);
  const drafts = invoices.filter((i) => i.status === "draft");
  const entity = entities[0];

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Money · {entity?.legal_name || "AI Real Solutions LLC"}</span>
        <h1>Invoicing &amp; Billing</h1>
        <p>Quotes, invoices, online payment by card or bank (Stripe), recurring billing and follow-ups for every business line.</p>
      </header>
      <ErrorBox message={bizError || error} />

      <div className={styles.tiles}>
        <div className={styles.tile}><small>Outstanding</small><strong>{money(open.reduce((n, i) => n + Number(i.balance_cents), 0))}</strong><span>{open.length} open invoice{open.length === 1 ? "" : "s"}</span></div>
        <div className={`${styles.tile} ${overdue.length ? styles.tileWarn : ""}`}><small>Overdue</small><strong>{money(overdue.reduce((n, i) => n + Number(i.balance_cents), 0))}</strong><span>{overdue.length} invoice{overdue.length === 1 ? "" : "s"}</span></div>
        <div className={styles.tile}><small>Received this month</small><strong>{money(paidThisMonth)}</strong><span>all payments</span></div>
        <div className={styles.tile}><small>Drafts</small><strong>{drafts.length}</strong><span>not sent yet</span></div>
      </div>

      <div className={styles.tabs} role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => choose(k)}>{label}</button>
        ))}
      </div>

      {loading && <p className={styles.muted}>Loading…</p>}
      {!loading && entity && (tab === "invoices" || tab === "quotes") && (
        <Documents kind={tab === "quotes" ? "quote" : "invoice"} invoices={invoices.filter((i) => i.kind === (tab === "quotes" ? "quote" : "invoice"))}
          customers={customers} businesses={businesses} entityId={entity.id} today={today} onError={setError} onGoCustomers={() => choose("customers")} />
      )}
      {!loading && entity && tab === "customers" && <Customers customers={customers} businesses={businesses} entityId={entity.id} invoices={invoices} onChanged={load} onError={setError} />}
      {!loading && entity && tab === "products" && <Products businesses={businesses} entityId={entity.id} onError={setError} />}
      {!loading && entity && tab === "recurring" && <Recurring customers={customers} businesses={businesses} entityId={entity.id} onError={setError} />}
      {!loading && entity && tab === "settings" && <BillingSettings entityId={entity.id} onError={setError} />}
    </section>
  );
}

function Documents({ kind, invoices, customers, businesses, entityId, today, onError, onGoCustomers }: {
  kind: "invoice" | "quote"; invoices: Invoice[]; customers: Customer[]; businesses: ReturnType<typeof useBusinesses>["businesses"];
  entityId: string; today: string; onError: (m: string) => void; onGoCustomers: () => void;
}) {
  const [view, setView] = useState<"open" | "draft" | "closed" | "all">("open");
  const [customer, setCustomer] = useState("");
  const [business, setBusiness] = useState("");
  const [busy, setBusy] = useState(false);
  const custById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const bizById = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const openStatuses = kind === "invoice" ? ["sent", "partial"] : ["sent", "accepted"];
  const shown = invoices.filter((i) =>
    view === "all" ? true : view === "draft" ? i.status === "draft" : view === "open" ? openStatuses.includes(i.status) : !openStatuses.includes(i.status) && i.status !== "draft");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!customer) return onError("Pick a customer first.");
    setBusy(true);
    try {
      const c = custById.get(customer);
      const terms = 15;
      const inv = await officeInsert<Invoice>("bill_invoices", {
        entity_id: entityId, customer_id: customer, business_id: business || c?.business_id || null, kind,
        issue_date: today, due_date: shiftDate(today, kind === "quote" ? 30 : terms),
      });
      window.location.assign(`/office/billing/${inv.id}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not create it.");
      setBusy(false);
    }
  }

  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={create}>
        {customers.length === 0 ? (
          <p className={styles.muted}>Add a customer first. <button type="button" className={styles.linkButton} onClick={onGoCustomers}>Go to Customers →</button></p>
        ) : (
          <div className={styles.formGrid4}>
            <label className={styles.field}>Customer
              <select value={customer} onChange={(e) => { setCustomer(e.target.value); const c = custById.get(e.target.value); if (c?.business_id) setBusiness(c.business_id); }} required>
                <option value="">Choose…</option>
                {customers.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="Business line" noneLabel="AI Real Solutions (general)" />
            <div className={styles.rowEnd} style={{ gridColumn: "span 2", alignSelf: "end" }}>
              <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Creating…" : `+ New ${kind}`}</button>
            </div>
          </div>
        )}
      </form>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Show">
          {([["open", "Open"], ["draft", "Drafts"], ["closed", kind === "invoice" ? "Paid & void" : "Closed"], ["all", "All"]] as const).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? styles.seg_focus : undefined} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <p className={styles.muted}>Nothing here.</p>}
      {shown.length > 0 && (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>Number</th><th>Customer</th><th>Business</th><th>Issued</th><th>{kind === "quote" ? "Valid until" : "Due"}</th><th className={styles.num}>Total</th>{kind === "invoice" && <th className={styles.num}>Balance</th>}<th>Status</th></tr></thead>
            <tbody>
              {shown.map((i) => {
                const late = kind === "invoice" && openStatuses.includes(i.status) && i.due_date && i.due_date < today;
                return (
                  <tr key={i.id} onClick={() => window.location.assign(`/office/billing/${i.id}`)} className={styles.rowLink}>
                    <td><a href={`/office/billing/${i.id}`}><strong>{i.number}</strong></a></td>
                    <td>{custById.get(i.customer_id)?.name || "—"}</td>
                    <td><BizTag business={i.business_id ? bizById.get(i.business_id) : undefined} /></td>
                    <td>{prettyDate(i.issue_date)}</td>
                    <td className={late ? styles.overdue : undefined}>{i.due_date ? prettyDate(i.due_date) : "—"}</td>
                    <td className={styles.num}>{money(i.total_cents)}</td>
                    {kind === "invoice" && <td className={styles.num}>{money(i.balance_cents)}</td>}
                    <td><span className={`${styles.statusPill} ${styles[`st_${i.status}`] || ""}`}>{late ? "Overdue" : STATUS_LABEL[i.status]}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
