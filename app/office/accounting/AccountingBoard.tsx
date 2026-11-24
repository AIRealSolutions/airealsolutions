"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeRest, officeToday } from "../lib/client";
import { Banking } from "./Banking";
import { Journal } from "./Journal";
import { Accounts } from "./Accounts";
import { Reports } from "./Reports";
import { Close } from "./Close";
import { balances, money, presets, useLedger, type Balance } from "./shared";

type Tab = "overview" | "banking" | "journal" | "accounts" | "reports" | "close";
const TABS: [Tab, string][] = [["overview", "Overview"], ["banking", "Banking"], ["journal", "Journal"], ["accounts", "Chart of accounts"], ["reports", "Reports"], ["close", "Close & export"]];

export default function AccountingBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const ledger = useLedger();
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState("");

  useEffect(() => {
    try { const t = localStorage.getItem("office.accounting.tab") as Tab | null; if (t && TABS.some(([k]) => k === t)) setTab(t); } catch { /* storage unavailable */ }
  }, []);
  const choose = (t: Tab) => { setTab(t); try { localStorage.setItem("office.accounting.tab", t); } catch { /* ignore */ } };

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Money · {ledger.entity?.legal_name || "AI Real Solutions LLC"}</span>
        <h1>Accounting</h1>
        <p>Double-entry books kept by the Office. Invoices, payments, bills, expenses and bank transactions post themselves; you review and close each month.</p>
      </header>
      <ErrorBox message={bizError || ledger.error || error} />
      <div className={styles.tabs} role="tablist">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => choose(k)}>{l}</button>)}
      </div>
      {ledger.entity && ledger.accounts.length > 0 && (
        <>
          {tab === "overview" && <Overview entityId={ledger.entity.id} fyStart={ledger.entity.fiscal_year_start_month} onGo={choose} onError={setError} />}
          {tab === "banking" && <Banking entityId={ledger.entity.id} accounts={ledger.accounts} businesses={businesses} onAccountsChanged={ledger.reload} onError={setError} />}
          {tab === "journal" && <Journal entityId={ledger.entity.id} accounts={ledger.accounts} businesses={businesses} onError={setError} />}
          {tab === "accounts" && <Accounts entityId={ledger.entity.id} accounts={ledger.accounts} onChanged={ledger.reload} onError={setError} />}
          {tab === "reports" && <Reports entity={ledger.entity} accounts={ledger.accounts} businesses={businesses} onError={setError} />}
          {tab === "close" && <Close entity={ledger.entity} onError={setError} />}
        </>
      )}
    </section>
  );
}

function Overview({ entityId, fyStart, onGo, onError }: { entityId: string; fyStart: number; onGo: (t: Tab) => void; onError: (m: string) => void }) {
  const [now, setNow] = useState<Balance[]>([]);
  const [month, setMonth] = useState<Balance[]>([]);
  const [ytd, setYtd] = useState<Balance[]>([]);
  const [toReview, setToReview] = useState(0);
  const [lastClosed, setLastClosed] = useState<string | null>(null);

  const load = useCallback(async () => {
    const p = presets(fyStart), today = officeToday();
    try {
      const [a, b, c, q, closed] = await Promise.all([
        balances(entityId, null, today), balances(entityId, p.month.from, today), balances(entityId, p.ytd.from, today),
        officeRest<{ id: string }[]>("acct_bank_txns?status=eq.new&pending=eq.false&select=id"),
        officeRest<{ period_start: string }[]>("acct_periods?status=eq.closed&select=period_start&order=period_start.desc&limit=1"),
      ]);
      setNow(a); setMonth(b); setYtd(c); setToReview(q.length); setLastClosed(closed[0]?.period_start ?? null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load the overview.");
    }
  }, [entityId, fyStart, onError]);
  useEffect(() => { void load(); }, [load]);

  const sum = (rows: Balance[], type: string) => rows.filter((r) => r.type === type).reduce((n, r) => n + Number(r.balance_cents), 0);
  const cash = now.filter((r) => r.subtype === "bank");
  const cards = now.filter((r) => r.subtype === "credit_card");
  const by = (key: string) => now.find((r) => r.code === key)?.balance_cents || 0;
  const uncategorized = ytd.find((r) => r.code === "6999")?.balance_cents || 0;

  return (
    <>
      <div className={styles.tiles}>
        <div className={styles.tile}><small>Cash in the bank</small><strong>{money(cash.reduce((n, r) => n + Number(r.balance_cents), 0))}</strong><span>{cash.map((c) => c.name).join(", ") || "No bank accounts"}</span></div>
        <div className={styles.tile}><small>Owed to you</small><strong>{money(by("1100"))}</strong><span>accounts receivable</span></div>
        <div className={styles.tile}><small>You owe</small><strong>{money(by("2000") + cards.reduce((n, r) => n + Number(r.balance_cents), 0))}</strong><span>bills + credit cards</span></div>
        <div className={styles.tile}><small>Profit this year</small><strong>{money(sum(ytd, "income") - sum(ytd, "expense"))}</strong><span>income {money(sum(ytd, "income"))} · expenses {money(sum(ytd, "expense"))}</span></div>
      </div>
      <div className={styles.twoCol} style={{ marginTop: 0 }}>
        <article className={styles.card}>
          <h2>This month</h2>
          <ul className={styles.plainList}>
            <li className={styles.reminderRow}><span>Income</span><strong>{money(sum(month, "income"))}</strong></li>
            <li className={styles.reminderRow}><span>Expenses</span><strong>{money(sum(month, "expense"))}</strong></li>
            <li className={styles.reminderRow}><span>Net</span><strong>{money(sum(month, "income") - sum(month, "expense"))}</strong></li>
          </ul>
        </article>
        <article className={styles.card}>
          <h2>To do</h2>
          <ul className={styles.plainList}>
            <li className={styles.reminderRow}><span>{toReview} bank transaction{toReview === 1 ? "" : "s"} to review</span>{toReview > 0 && <button className={styles.linkButton} onClick={() => onGo("banking")}>Review →</button>}</li>
            <li className={styles.reminderRow}><span>{uncategorized ? `${money(uncategorized)} in Uncategorized expense this year` : "Nothing uncategorized"}</span>{uncategorized > 0 && <button className={styles.linkButton} onClick={() => onGo("journal")}>Fix →</button>}</li>
            <li className={styles.reminderRow}><span>{lastClosed ? `Books closed through ${new Date(`${lastClosed}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}` : "No month closed yet"}</span><button className={styles.linkButton} onClick={() => onGo("close")}>Close & export →</button></li>
          </ul>
        </article>
      </div>
    </>
  );
}
