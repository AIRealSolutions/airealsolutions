"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BusinessSelect } from "../components";
import { officeRest, officeRpc, officeToday, type Business } from "../lib/client";
import { balances, downloadCsv, money, presets, type Account, type Balance, type Entity } from "./shared";

type Report = "pl" | "pl_business" | "bs" | "tb" | "ar" | "ap" | "cash" | "contractors";
const REPORTS: [Report, string][] = [
  ["pl", "Profit & loss"], ["pl_business", "P&L by business line"], ["bs", "Balance sheet"], ["tb", "Trial balance"],
  ["ar", "Who owes you (A/R aging)"], ["ap", "What you owe (A/P aging)"], ["cash", "Cash in & out"], ["contractors", "Contractor payments (1099)"],
];
type Table = { title: string; head: string[]; rows: (string | number)[][]; money: number[]; strong?: number[]; note?: string };

const daysLate = (due: string | null, asOf: string) => (due ? Math.floor((Date.parse(`${asOf}T12:00:00Z`) - Date.parse(`${due}T12:00:00Z`)) / 86_400_000) : 0);
const bucket = (d: number) => (d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4);

export function Reports({ entity, accounts, businesses, onError }: { entity: Entity; accounts: Account[]; businesses: Business[]; onError: (m: string) => void }) {
  const p = presets(entity.fiscal_year_start_month);
  const [report, setReport] = useState<Report>("pl");
  const [range, setRange] = useState(p.ytd);
  const [business, setBusiness] = useState("");
  const [table, setTable] = useState<Table | null>(null);
  const [loading, setLoading] = useState(false);
  const asOf = range.to;

  const run = useCallback(async () => {
    setLoading(true);
    try {
      setTable(await build(report, entity, range.from, range.to, business, businesses, accounts));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not run the report.");
    } finally {
      setLoading(false);
    }
  }, [report, entity, range.from, range.to, business, businesses, accounts, onError]);
  useEffect(() => { void run(); }, [run]);

  const usesRange = !["bs", "tb", "ar", "ap"].includes(report);

  return (
    <>
      <div className={`${styles.card} ${styles.addForm}`}>
        <div className={styles.formGrid4}>
          <label className={`${styles.field} ${styles.span2}`}>Report
            <select value={report} onChange={(e) => setReport(e.target.value as Report)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
          <label className={styles.field}>Period
            <select value="" onChange={(e) => { const r = p[e.target.value]; if (r) setRange(r); }}>
              <option value="">{range.label}</option>
              {Object.entries(p).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
          </label>
          {report === "pl" && <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="Business line" noneLabel="All (whole LLC)" />}
          {usesRange && <label className={styles.field}>From<input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value, label: "Custom" })} /></label>}
          <label className={styles.field}>{usesRange ? "To" : "As of"}<input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value, label: "Custom" })} /></label>
        </div>
      </div>

      {loading && <p className={styles.muted}>Running…</p>}
      {table && !loading && (
        <article className={`${styles.card} ${styles.report}`}>
          <div className={styles.cardHead}>
            <div>
              <h2>{table.title}</h2>
              <small className={styles.muted}>{entity.legal_name} · {usesRange ? `${range.from} to ${range.to}` : `as of ${asOf}`}{report === "pl" && business ? ` · ${businesses.find((b) => b.id === business)?.name}` : ""}</small>
            </div>
            <div className={styles.rowActions}>
              <button type="button" className={styles.linkButton} onClick={() => downloadCsv(`${report}-${range.from}-${range.to}.csv`, [table.head, ...table.rows.map((r) => r.map((c, i) => (table.money.includes(i) && typeof c === "number" ? (c / 100).toFixed(2) : c)))])}>Download CSV</button>
              <button type="button" className={styles.linkButton} onClick={() => window.print()}>Print</button>
            </div>
          </div>
          <div className={styles.tableWrap} style={{ padding: 0 }}>
            <table className={styles.table}>
              <thead><tr>{table.head.map((h, i) => <th key={i} className={table.money.includes(i) ? styles.num : undefined}>{h}</th>)}</tr></thead>
              <tbody>
                {table.rows.map((r, ri) => (
                  <tr key={ri} className={table.strong?.includes(ri) ? styles.totalRow : undefined}>
                    {r.map((c, i) => <td key={i} className={table.money.includes(i) ? styles.num : undefined}>{table.money.includes(i) && typeof c === "number" ? money(c) : c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.note && <small className={styles.muted}>{table.note}</small>}
        </article>
      )}
    </>
  );
}

async function build(report: Report, entity: Entity, from: string, to: string, business: string, businesses: Business[], accounts: Account[]): Promise<Table> {
  const sumType = (rows: Balance[], t: string) => rows.filter((r) => r.type === t).reduce((n, r) => n + Number(r.balance_cents), 0);
  const nonzero = (rows: Balance[], t: string) => rows.filter((r) => r.type === t && Number(r.balance_cents) !== 0);

  if (report === "pl") {
    const b = await balances(entity.id, from, to, business || null);
    const inc = nonzero(b, "income"), exp = nonzero(b, "expense");
    const rows: (string | number)[][] = [["Income", ""], ...inc.map((r) => [`  ${r.code} ${r.name}`, r.balance_cents]), ["Total income", sumType(b, "income")],
      ["Expenses", ""], ...exp.map((r) => [`  ${r.code} ${r.name}`, r.balance_cents]), ["Total expenses", sumType(b, "expense")], ["Net profit", sumType(b, "income") - sumType(b, "expense")]];
    const strong = rows.map((r, i) => (String(r[0]).startsWith("Total") || r[0] === "Net profit" || r[0] === "Income" || r[0] === "Expenses" ? i : -1)).filter((i) => i >= 0);
    return { title: "Profit & loss", head: ["Account", "Amount"], rows, money: [1], strong };
  }

  if (report === "pl_business") {
    const data = await officeRpc<{ business_id: string | null; account_id: string; amount_cents: number }[]>("acct_pl_by_business", { p_entity: entity.id, p_from: from, p_to: to });
    const type = (id: string) => accounts.find((a) => a.id === id)?.type;
    const keys = [...new Set(data.map((d) => d.business_id || ""))];
    const rows = keys.map((k) => {
      const inc = data.filter((d) => (d.business_id || "") === k && type(d.account_id) === "income").reduce((n, d) => n + Number(d.amount_cents), 0);
      const exp = data.filter((d) => (d.business_id || "") === k && type(d.account_id) === "expense").reduce((n, d) => n + Number(d.amount_cents), 0);
      return [businesses.find((b) => b.id === k)?.name || "General / overhead", inc, exp, inc - exp] as (string | number)[];
    }).sort((a, b) => Number(b[3]) - Number(a[3]));
    const tot = rows.reduce((t, r) => [t[0], Number(t[1]) + Number(r[1]), Number(t[2]) + Number(r[2]), Number(t[3]) + Number(r[3])], ["Total", 0, 0, 0] as (string | number)[]);
    return { title: "Profit & loss by business line", head: ["Business line", "Income", "Expenses", "Net"], rows: [...rows, tot], money: [1, 2, 3], strong: [rows.length], note: "Income and expenses tagged to a venture or client. Untagged items are General / overhead." };
  }

  if (report === "bs") {
    const fyStart = presets(entity.fiscal_year_start_month).ytd.from;
    const fy = to >= fyStart ? fyStart : `${Number(fyStart.slice(0, 4)) - 1}${fyStart.slice(4)}`;
    const [all, cur] = await Promise.all([balances(entity.id, null, to), balances(entity.id, fy, to)]);
    const current = sumType(cur, "income") - sumType(cur, "expense");
    const retained = sumType(all, "income") - sumType(all, "expense") - current;
    const section = (t: string, label: string) => [[label, ""], ...nonzero(all, t).map((r) => [`  ${r.code} ${r.name}`, r.balance_cents])] as (string | number)[][];
    const assets = sumType(all, "asset"), liab = sumType(all, "liability"), eq = sumType(all, "equity") + retained + current;
    const rows: (string | number)[][] = [
      ...section("asset", "Assets"), ["Total assets", assets],
      ...section("liability", "Liabilities"), ["Total liabilities", liab],
      ...section("equity", "Equity"), ["  Retained earnings (prior years)", retained], ["  Net profit this year", current], ["Total equity", eq],
      ["Total liabilities & equity", liab + eq],
    ];
    const strong = rows.map((r, i) => (String(r[0]).startsWith("Total") || ["Assets", "Liabilities", "Equity"].includes(String(r[0])) ? i : -1)).filter((i) => i >= 0);
    return { title: "Balance sheet", head: ["Account", "Amount"], rows, money: [1], strong, note: assets === liab + eq ? "Balanced ✓" : `Out of balance by ${money(assets - liab - eq)}. Tell Claude: this should never happen.` };
  }

  if (report === "tb") {
    const b = (await balances(entity.id, null, to)).filter((r) => Number(r.debit_cents) || Number(r.credit_cents));
    const rows = b.map((r) => { const net = Number(r.debit_cents) - Number(r.credit_cents); return [r.code, r.name, net > 0 ? net : "", net < 0 ? -net : ""] as (string | number)[]; });
    const d = rows.reduce((n, r) => n + (Number(r[2]) || 0), 0), c = rows.reduce((n, r) => n + (Number(r[3]) || 0), 0);
    return { title: "Trial balance", head: ["Account", "Name", "Debit", "Credit"], rows: [...rows, ["", "Total", d, c]], money: [2, 3], strong: [rows.length], note: d === c ? "Debits equal credits ✓" : "Debits and credits differ." };
  }

  if (report === "ar") {
    const inv = await officeRest<{ number: string; due_date: string | null; balance_cents: number; bill_customers: { name: string } | null }[]>(
      `bill_invoices?kind=eq.invoice&status=in.(sent,partial)&issue_date=lte.${to}&select=number,due_date,balance_cents,bill_customers(name)&order=due_date.asc`);
    return aging("Who owes you (A/R aging)", inv.map((i) => ({ who: i.bill_customers?.name || "—", ref: i.number, due: i.due_date, amount: Number(i.balance_cents) })), to);
  }

  if (report === "ap") {
    const bills = await officeRest<{ vendor: string; due_date: string | null; amount_cents: number }[]>(`acct_bills?status=eq.open&bill_date=lte.${to}&select=vendor,due_date,amount_cents&order=due_date.asc`);
    return aging("What you owe (A/P aging)", bills.map((b) => ({ who: b.vendor, ref: "", due: b.due_date, amount: Number(b.amount_cents) })), to);
  }

  if (report === "cash") {
    const rows = await officeRpc<{ month: string; money_in_cents: number; money_out_cents: number }[]>("acct_cash_by_month", { p_entity: entity.id, p_from: from, p_to: to });
    const out = rows.map((r) => [new Date(`${r.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), Number(r.money_in_cents), Number(r.money_out_cents), Number(r.money_in_cents) - Number(r.money_out_cents)] as (string | number)[]);
    const tot = out.reduce((t, r) => ["Total", Number(t[1]) + Number(r[1]), Number(t[2]) + Number(r[2]), Number(t[3]) + Number(r[3])], ["Total", 0, 0, 0] as (string | number)[]);
    return { title: "Cash in & out (bank accounts)", head: ["Month", "Money in", "Money out", "Net"], rows: [...out, tot], money: [1, 2, 3], strong: [out.length] };
  }

  // Contractors: expenses and paid bills booked to contractor accounts, by vendor.
  const contractorIds = accounts.filter((a) => a.subtype === "contractor").map((a) => a.id);
  if (!contractorIds.length) return { title: "Contractor payments", head: ["Vendor", "Paid"], rows: [], money: [1], note: "No contractor accounts." };
  const ids = contractorIds.join(",");
  const [exps, bills] = await Promise.all([
    officeRest<{ vendor: string; amount_cents: number }[]>(`acct_expenses?expense_account_id=in.(${ids})&spent_on=gte.${from}&spent_on=lte.${to}&select=vendor,amount_cents`),
    officeRest<{ vendor: string; amount_cents: number }[]>(`acct_bills?status=eq.paid&expense_account_id=in.(${ids})&paid_on=gte.${from}&paid_on=lte.${to}&select=vendor,amount_cents`),
  ]);
  const by = new Map<string, number>();
  for (const x of [...exps, ...bills]) by.set(x.vendor.trim(), (by.get(x.vendor.trim()) || 0) + Number(x.amount_cents));
  const rows = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([v, c]) => [v, c] as (string | number)[]);
  return { title: "Contractor payments (for 1099s)", head: ["Vendor", "Paid in period"], rows, money: [1], note: "Contractors paid by card or through a payment app usually don't get a 1099 from you. Confirm the current 1099 filing threshold and each contractor's W-9 with your CPA." };
}

function aging(title: string, items: { who: string; ref: string; due: string | null; amount: number }[], asOf: string): Table {
  const labels = ["Current", "1-30 days", "31-60", "61-90", "Over 90"];
  const by = new Map<string, number[]>();
  for (const i of items) {
    const row = by.get(i.who) || [0, 0, 0, 0, 0];
    row[bucket(daysLate(i.due, asOf))] += i.amount;
    by.set(i.who, row);
  }
  const rows = [...by.entries()].map(([who, b]) => [who, ...b, b.reduce((n, x) => n + x, 0)] as (string | number)[]);
  const tot = rows.reduce((t, r) => t.map((v, i) => (i === 0 ? "Total" : Number(v) + Number(r[i]))), ["Total", 0, 0, 0, 0, 0, 0] as (string | number)[]);
  return { title, head: ["Name", ...labels, "Total"], rows: [...rows, tot], money: [1, 2, 3, 4, 5, 6], strong: [rows.length] };
}
