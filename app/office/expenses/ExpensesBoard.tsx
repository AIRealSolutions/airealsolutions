"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { api } from "../../factory/connections/session";
import { officeDelete, officeInsert, officePatch, officeRest, officeToday, prettyDate, type Business } from "../lib/client";
import { accountLabel, money, receiptLink, toCents, uploadReceipt, useLedger, type Account, type Entity } from "../accounting/shared";

type Expense = { id: string; vendor: string; spent_on: string; amount_cents: number; expense_account_id: string; paid_from_account_id: string; business_id: string | null; memo: string | null; receipt_path: string | null; mileage_miles: number | null; source: string };
type Bill = { id: string; vendor: string; bill_date: string; due_date: string | null; amount_cents: number; expense_account_id: string; business_id: string | null; memo: string | null; receipt_path: string | null; status: "open" | "paid" | "void"; paid_on: string | null; paid_from_account_id: string | null };
type Tab = "expenses" | "bills" | "mileage";
type ReceiptRead = { is_receipt: boolean; vendor: string; date: string; total_cents: number; description: string; account_code: string; business_slug: string };

export default function ExpensesBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const { entity, accounts, error: ledgerError, reload: reloadLedger } = useLedger();
  const [tab, setTab] = useState<Tab>("expenses");
  const [error, setError] = useState("");
  const expenseAccounts = accounts.filter((a) => a.type === "expense" && a.active);
  const payFrom = accounts.filter((a) => a.active && (a.subtype === "bank" || a.subtype === "credit_card" || a.system_key === "owner_equity"));

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Money</span>
        <h1>Expenses &amp; Bills</h1>
        <p>What the LLC spends and owes. Every expense and bill posts to the books on its own, tagged to a business line.</p>
      </header>
      <ErrorBox message={bizError || ledgerError || error} />
      <div className={styles.tabs} role="tablist">
        {([["expenses", "Expenses"], ["bills", "Bills to pay"], ["mileage", "Mileage"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {entity && tab === "expenses" && <Expenses entity={entity} expenseAccounts={expenseAccounts} payFrom={payFrom} accounts={accounts} businesses={businesses} onError={setError} />}
      {entity && tab === "bills" && <Bills entity={entity} expenseAccounts={expenseAccounts} payFrom={payFrom} accounts={accounts} businesses={businesses} onError={setError} />}
      {entity && tab === "mileage" && <Mileage entity={entity} accounts={accounts} businesses={businesses} onError={setError} onSettings={reloadLedger} />}
    </section>
  );
}

function AccountSelect({ label, accounts, value, onChange }: { label: string; accounts: Account[]; value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.field}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Choose…</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
      </select>
    </label>
  );
}

/** Upload a receipt and (when AI is on) read it into the form. */
function ReceiptField({ path, onPath, onRead, onError }: { path: string | null; onPath: (p: string | null) => void; onRead: (r: ReceiptRead) => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState("");
  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy("Uploading…");
    try {
      const p = await uploadReceipt(file);
      onPath(p);
      setBusy("Reading with AI…");
      try {
        const r = await api<{ receipt: ReceiptRead }>("/api/office/receipts/read", { method: "POST", body: JSON.stringify({ path: p }) });
        if (r.receipt.is_receipt) onRead(r.receipt);
        else onError("That doesn't look like a receipt; it's attached, but fill the form by hand.");
      } catch (e) {
        onError(`Receipt attached. ${e instanceof Error ? e.message : ""}`.trim());
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy("");
    }
  }
  return (
    <label className={styles.field}>Receipt
      <input type="file" accept="image/*,application/pdf" capture="environment" onChange={(e) => void pick(e.target.files?.[0])} disabled={!!busy} />
      <small className={styles.muted}>{busy || (path ? "Attached ✓" : "Photo or PDF. AI fills in the form.")}</small>
    </label>
  );
}

function ViewReceipt({ path, onError }: { path: string | null; onError: (m: string) => void }) {
  if (!path) return null;
  return <button type="button" className={styles.linkButton} onClick={async () => { try { window.open(await receiptLink(path), "_blank", "noopener"); } catch (e) { onError(e instanceof Error ? e.message : "Could not open."); } }}>Receipt</button>;
}

function Expenses({ entity, expenseAccounts, payFrom, accounts, businesses, onError }: { entity: Entity; expenseAccounts: Account[]; payFrom: Account[]; accounts: Account[]; businesses: Business[]; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Expense[]>([]);
  const [month, setMonth] = useState(officeToday().slice(0, 7));
  const blank = { vendor: "", date: officeToday(), amount: "", account: "", from: "", business: "", memo: "", receipt: null as string | null };
  const [f, setF] = useState(blank);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const load = useCallback(async () => {
    const [y, m] = month.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    try { setRows(await officeRest<Expense[]>(`acct_expenses?spent_on=gte.${month}-01&spent_on=lt.${end}&select=*&order=spent_on.desc,created_at.desc`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load expenses."); }
  }, [month, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!f.from && payFrom.length) setF((v) => ({ ...v, from: (payFrom.find((a) => a.subtype === "credit_card") || payFrom[0]).id })); }, [payFrom, f.from]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const cents = toCents(f.amount);
    if (!f.vendor.trim() || !cents || !f.account || !f.from) return onError("Fill in vendor, amount, category and paid from.");
    try {
      await officeInsert("acct_expenses", { entity_id: entity.id, vendor: f.vendor.trim(), spent_on: f.date, amount_cents: cents, expense_account_id: f.account, paid_from_account_id: f.from, business_id: f.business || null, memo: f.memo.trim() || null, receipt_path: f.receipt, source: f.receipt ? "receipt" : "manual" });
      setF({ ...blank, from: f.from });
      onError("");
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  }
  const total = rows.reduce((n, r) => n + Number(r.amount_cents), 0);

  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <ReceiptField path={f.receipt} onPath={(p) => setF((v) => ({ ...v, receipt: p }))} onError={onError} onRead={(r) => setF((v) => ({
            ...v, vendor: r.vendor || v.vendor, date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : v.date, amount: r.total_cents ? (r.total_cents / 100).toFixed(2) : v.amount,
            account: expenseAccounts.find((a) => a.code === r.account_code)?.id || v.account, business: businesses.find((b) => b.slug === r.business_slug)?.id || v.business, memo: r.description || v.memo,
          }))} />
          <label className={styles.field}>Vendor<input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} placeholder="Vercel" required /></label>
          <label className={styles.field}>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></label>
          <label className={styles.field}>Amount ($)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="20.00" required /></label>
          <AccountSelect label="Category" accounts={expenseAccounts} value={f.account} onChange={(v) => setF({ ...f, account: v })} />
          <AccountSelect label="Paid from" accounts={payFrom} value={f.from} onChange={(v) => setF({ ...f, from: v })} />
          <BusinessSelect businesses={businesses} value={f.business} onChange={(v) => setF({ ...f, business: v })} label="Business line" noneLabel="General overhead" />
          <label className={styles.field}>Note<input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>
        </div>
        <div className={styles.rowEnd}><button className="button button-primary" type="submit">Add expense</button></div>
      </form>

      <div className={styles.toolbar}>
        <label className={styles.field} style={{ maxWidth: 200 }}>Month<input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
        <strong>{money(total)} in {rows.length} expense{rows.length === 1 ? "" : "s"}</strong>
      </div>
      {rows.length === 0 && <p className={styles.muted}>No expenses this month.</p>}
      {rows.length > 0 && (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>Date</th><th>Vendor</th><th>Category</th><th>Paid from</th><th>Business</th><th className={styles.num}>Amount</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{prettyDate(r.spent_on)}</td>
                  <td><strong>{r.vendor}</strong>{r.memo && <div><small className={styles.muted}>{r.memo}</small></div>}</td>
                  <td>{byId.get(r.expense_account_id)?.name}</td>
                  <td>{byId.get(r.paid_from_account_id)?.name}</td>
                  <td><BizTag business={businesses.find((b) => b.id === r.business_id)} /></td>
                  <td className={styles.num}>{money(r.amount_cents)}</td>
                  <td className={styles.rowActions}>
                    <ViewReceipt path={r.receipt_path} onError={onError} />
                    <button type="button" className={styles.linkButton} onClick={async () => { if (!window.confirm(`Delete the ${r.vendor} expense? Its journal entry is reversed.`)) return; try { await officeDelete("acct_expenses", r.id); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not delete."); } }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Bills({ entity, expenseAccounts, payFrom, accounts, businesses, onError }: { entity: Entity; expenseAccounts: Account[]; payFrom: Account[]; accounts: Account[]; businesses: Business[]; onError: (m: string) => void }) {
  const [rows, setRows] = useState<Bill[]>([]);
  const [view, setView] = useState<"open" | "paid">("open");
  const blank = { vendor: "", bill_date: officeToday(), due: "", amount: "", account: "", business: "", memo: "", receipt: null as string | null };
  const [f, setF] = useState(blank);
  const [paying, setPaying] = useState<{ id: string; date: string; from: string } | null>(null);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const today = officeToday();

  const load = useCallback(async () => {
    try { setRows(await officeRest<Bill[]>(`acct_bills?status=eq.${view}&select=*&order=${view === "open" ? "due_date.asc.nullslast" : "paid_on.desc"}&limit=200`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load bills."); }
  }, [view, onError]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const cents = toCents(f.amount);
    if (!f.vendor.trim() || !cents || !f.account) return onError("Fill in vendor, amount and category.");
    try {
      await officeInsert("acct_bills", { entity_id: entity.id, vendor: f.vendor.trim(), bill_date: f.bill_date, due_date: f.due || null, amount_cents: cents, expense_account_id: f.account, business_id: f.business || null, memo: f.memo.trim() || null, receipt_path: f.receipt });
      if (f.due) {
        await officeInsert("office_reminders", { title: `Pay ${f.vendor.trim()} bill (${money(cents)})`, business_id: f.business || null, remind_at: new Date(`${f.due}T09:00:00`).toISOString() }).catch(() => undefined);
      }
      setF(blank);
      onError("");
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  }
  async function markPaid() {
    if (!paying?.from) return onError("Choose the account it was paid from.");
    try {
      await officePatch("acct_bills", `id=eq.${paying.id}`, { status: "paid", paid_on: paying.date, paid_from_account_id: paying.from });
      setPaying(null);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not mark paid.");
    }
  }
  const owed = rows.filter((r) => r.status === "open").reduce((n, r) => n + Number(r.amount_cents), 0);

  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <ReceiptField path={f.receipt} onPath={(p) => setF((v) => ({ ...v, receipt: p }))} onError={onError} onRead={(r) => setF((v) => ({
            ...v, vendor: r.vendor || v.vendor, bill_date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : v.bill_date, amount: r.total_cents ? (r.total_cents / 100).toFixed(2) : v.amount,
            account: expenseAccounts.find((a) => a.code === r.account_code)?.id || v.account, business: businesses.find((b) => b.slug === r.business_slug)?.id || v.business, memo: r.description || v.memo,
          }))} />
          <label className={styles.field}>Vendor<input value={f.vendor} onChange={(e) => setF({ ...f, vendor: e.target.value })} required /></label>
          <label className={styles.field}>Bill date<input type="date" value={f.bill_date} onChange={(e) => setF({ ...f, bill_date: e.target.value })} required /></label>
          <label className={styles.field}>Due<input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></label>
          <label className={styles.field}>Amount ($)<input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></label>
          <AccountSelect label="Category" accounts={expenseAccounts} value={f.account} onChange={(v) => setF({ ...f, account: v })} />
          <BusinessSelect businesses={businesses} value={f.business} onChange={(v) => setF({ ...f, business: v })} label="Business line" noneLabel="General overhead" />
          <label className={styles.field}>Note<input value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} /></label>
        </div>
        <div className={styles.rowEnd}><small className={styles.muted}>A reminder is added for the due date.</small><button className="button button-primary" type="submit">Add bill</button></div>
      </form>

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Show">
          {(["open", "paid"] as const).map((v) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? styles.seg_focus : undefined} onClick={() => setView(v)}>{v === "open" ? "To pay" : "Paid"}</button>)}
        </div>
        {view === "open" && <strong>{money(owed)} owed</strong>}
      </div>
      {rows.length === 0 && <p className={styles.muted}>{view === "open" ? "No bills waiting." : "No paid bills yet."}</p>}
      <ul className={styles.feedList}>
        {rows.map((b) => (
          <li key={b.id} className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h3>{b.vendor}</h3>
                <span className={styles.taskMeta}>
                  <small className={styles.muted}>{byId.get(b.expense_account_id)?.name}</small>
                  <BizTag business={businesses.find((x) => x.id === b.business_id)} />
                  {b.status === "open" && b.due_date && <small className={b.due_date < today ? styles.overdue : styles.muted}>Due {prettyDate(b.due_date)}</small>}
                  {b.status === "paid" && <small className={styles.muted}>Paid {prettyDate(b.paid_on)} from {byId.get(b.paid_from_account_id || "")?.name}</small>}
                </span>
              </div>
              <strong>{money(b.amount_cents)}</strong>
            </div>
            {paying?.id === b.id ? (
              <div className={styles.formGrid4}>
                <label className={styles.field}>Paid on<input type="date" value={paying.date} onChange={(e) => setPaying({ ...paying, date: e.target.value })} /></label>
                <AccountSelect label="Paid from" accounts={payFrom} value={paying.from} onChange={(v) => setPaying({ ...paying, from: v })} />
                <div className={styles.rowEnd} style={{ gridColumn: "span 2", alignSelf: "end" }}>
                  <button type="button" className={styles.linkButton} onClick={() => setPaying(null)}>Cancel</button>
                  <button type="button" className="button button-primary" onClick={() => void markPaid()}>Mark paid</button>
                </div>
              </div>
            ) : (
              <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                {b.status === "open" && <button type="button" className="button button-secondary" onClick={() => setPaying({ id: b.id, date: today, from: payFrom.find((a) => a.system_key === "checking")?.id || payFrom[0]?.id || "" })}>Mark paid…</button>}
                <ViewReceipt path={b.receipt_path} onError={onError} />
                {b.status === "open" && <button type="button" className={styles.linkButton} onClick={async () => { if (window.confirm(`Void the ${b.vendor} bill?`)) { try { await officePatch("acct_bills", `id=eq.${b.id}`, { status: "void" }); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not void."); } } }}>Void</button>}
                {b.status === "paid" && <button type="button" className={styles.linkButton} onClick={async () => { try { await officePatch("acct_bills", `id=eq.${b.id}`, { status: "open", paid_on: null, paid_from_account_id: null }); await load(); } catch (e) { onError(e instanceof Error ? e.message : "Could not undo."); } }}>Undo payment</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function Mileage({ entity, accounts, businesses, onError, onSettings }: { entity: Entity; accounts: Account[]; businesses: Business[]; onError: (m: string) => void; onSettings: () => Promise<void> }) {
  const rate = entity.settings?.mileage_rate_cents ?? 70;
  const [rateInput, setRateInput] = useState((rate / 100).toFixed(3).replace(/0$/, ""));
  const [rows, setRows] = useState<Expense[]>([]);
  const [f, setF] = useState({ date: officeToday(), miles: "", purpose: "", business: "" });
  const year = officeToday().slice(0, 4);
  const mileageAcct = accounts.find((a) => a.system_key === "mileage");
  const owner = accounts.find((a) => a.system_key === "owner_equity");

  const load = useCallback(async () => {
    try { setRows(await officeRest<Expense[]>(`acct_expenses?source=eq.mileage&spent_on=gte.${year}-01-01&select=*&order=spent_on.desc`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load mileage."); }
  }, [year, onError]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const miles = Number(f.miles);
    if (!(miles > 0) || !f.purpose.trim()) return onError("Enter the miles and the business purpose.");
    if (!mileageAcct || !owner) return onError("The mileage and owner accounts are missing. Re-run docs/office-phase4.sql.");
    try {
      await officeInsert("acct_expenses", {
        entity_id: entity.id, vendor: "Mileage", spent_on: f.date, amount_cents: Math.round(miles * rate), expense_account_id: mileageAcct.id,
        paid_from_account_id: owner.id, business_id: f.business || null, memo: f.purpose.trim(), mileage_miles: miles, source: "mileage",
      });
      setF({ ...f, miles: "", purpose: "" });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save.");
    }
  }
  async function saveRate() {
    const c = Math.round(Number(rateInput) * 100 * 10) / 10;
    if (!(c > 0 && c < 500)) return onError("Enter the rate in dollars per mile, e.g. 0.70.");
    try { await officePatch("acct_entities", `id=eq.${entity.id}`, { settings: { ...entity.settings, mileage_rate_cents: c } }); await onSettings(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not save the rate."); }
  }
  const miles = rows.reduce((n, r) => n + Number(r.mileage_miles || 0), 0);

  return (
    <>
      <div className={styles.note}>
        Business miles in your own vehicle are recorded at the IRS standard rate as an expense the LLC owes you (booked to Owner contributions).
        Check the current IRS rate each January.
        <span className={styles.inlineEdit} style={{ marginLeft: 8 }}>
          Rate $<input className={styles.smallInput} value={rateInput} onChange={(e) => setRateInput(e.target.value)} aria-label="Dollars per mile" />/mile
          <button type="button" className={styles.linkButton} onClick={() => void saveRate()}>Save</button>
        </span>
      </div>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Date<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label className={styles.field}>Miles<input inputMode="decimal" value={f.miles} onChange={(e) => setF({ ...f, miles: e.target.value })} placeholder="24" /></label>
          <label className={styles.field}>Business purpose<input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Client meeting, Southport" /></label>
          <BusinessSelect businesses={businesses} value={f.business} onChange={(v) => setF({ ...f, business: v })} label="Business line" noneLabel="General" />
        </div>
        <div className={styles.rowEnd}><small className={styles.muted}>{f.miles ? `= ${money(Math.round(Number(f.miles) * rate))}` : ""}</small><button className="button button-primary" type="submit">Log trip</button></div>
      </form>
      <h2 className={styles.sectionTitle}>{year}: {miles.toLocaleString()} miles · {money(rows.reduce((n, r) => n + Number(r.amount_cents), 0))}</h2>
      <ul className={`${styles.card} ${styles.plainList}`}>
        {rows.length === 0 && <li className={styles.muted}>No trips logged this year.</li>}
        {rows.map((r) => (
          <li key={r.id} className={styles.reminderRow}>
            <div><strong>{prettyDate(r.spent_on)} · {Number(r.mileage_miles)} mi</strong><small className={styles.muted}>{r.memo}</small></div>
            <span>{money(r.amount_cents)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
