"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { officeRest, officeToday } from "../lib/client";
import { balances, downloadCsv, officeRestAll, presets, type Entity } from "./shared";

type Period = { period_start: string; status: "open" | "closed"; closed_at: string | null };
type Month = { start: string; label: string; entries: number; toReview: number; status: "open" | "closed" };

export function Close({ entity, onError }: { entity: Entity; onError: (m: string) => void }) {
  const [months, setMonths] = useState<Month[]>([]);
  const p = presets(entity.fiscal_year_start_month);
  const [from, setFrom] = useState(p.last_year.from);
  const [to, setTo] = useState(officeToday());
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const today = officeToday();
      const [periods, first, entries, review] = await Promise.all([
        officeRest<Period[]>("acct_periods?select=period_start,status,closed_at"),
        officeRest<{ entry_date: string }[]>("acct_journal_entries?select=entry_date&order=entry_date.asc&limit=1"),
        officeRestAll<{ entry_date: string }>(`acct_journal_entries?entry_date=gte.${Number(today.slice(0, 4)) - 2}-01-01&select=entry_date&order=entry_date.asc`),
        officeRestAll<{ posted_on: string }>("acct_bank_txns?status=eq.new&pending=eq.false&select=posted_on&order=posted_on.asc"),
      ]);
      const start = first[0]?.entry_date.slice(0, 7) || today.slice(0, 7);
      const list: Month[] = [];
      for (let d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`); d.toISOString().slice(0, 7) >= start && list.length < 36; d.setUTCMonth(d.getUTCMonth() - 1)) {
        const m = d.toISOString().slice(0, 7);
        list.push({
          start: `${m}-01`,
          label: d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }),
          entries: entries.filter((e) => e.entry_date.startsWith(m)).length,
          toReview: review.filter((r) => r.posted_on.startsWith(m)).length,
          status: periods.find((x) => x.period_start === `${m}-01`)?.status || "open",
        });
      }
      setMonths(list);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load months.");
    }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  async function setStatus(m: Month, status: "open" | "closed") {
    if (status === "closed" && m.toReview && !window.confirm(`${m.toReview} bank transaction${m.toReview === 1 ? "" : "s"} in ${m.label} still need review. Close anyway?`)) return;
    if (status === "open" && !window.confirm(`Reopen ${m.label}? Changes to that month will change reports you may have already shared.`)) return;
    try {
      await officeRest("acct_periods?on_conflict=entity_id,period_start", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ entity_id: entity.id, period_start: m.start, status, closed_at: status === "closed" ? new Date().toISOString() : null }),
      });
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not update the month."); }
  }

  async function exportJournal() {
    setBusy("journal");
    try {
      const [entries, lines, accounts, businesses] = await Promise.all([
        officeRestAll<{ id: string; entry_no: number; entry_date: string; memo: string | null; source_type: string }>(`acct_journal_entries?entry_date=gte.${from}&entry_date=lte.${to}&select=id,entry_no,entry_date,memo,source_type&order=entry_date.asc,entry_no.asc`),
        officeRestAll<{ entry_id: string; account_id: string; debit_cents: number; credit_cents: number; business_id: string | null; memo: string | null }>(`acct_journal_lines?select=entry_id,account_id,debit_cents,credit_cents,business_id,memo,acct_journal_entries!inner(entry_date)&acct_journal_entries.entry_date=gte.${from}&acct_journal_entries.entry_date=lte.${to}&order=id.asc`, 500000),
        officeRest<{ id: string; code: string; name: string }[]>("acct_accounts?select=id,code,name"),
        officeRest<{ id: string; name: string }[]>("office_businesses?select=id,name"),
      ]);
      const ids = new Set(entries.map((e) => e.id));
      const acct = new Map(accounts.map((a) => [a.id, a]));
      const biz = new Map(businesses.map((b) => [b.id, b.name]));
      const rows: (string | number)[][] = [["Journal No", "Date", "Account Number", "Account", "Debit", "Credit", "Business Line", "Description", "Source"]];
      const byEntry = new Map<string, typeof lines>();
      for (const l of lines) if (ids.has(l.entry_id)) byEntry.set(l.entry_id, [...(byEntry.get(l.entry_id) || []), l]);
      for (const e of entries) {
        for (const l of byEntry.get(e.id) || []) {
          const a = acct.get(l.account_id);
          rows.push([e.entry_no, e.entry_date, a?.code || "", a?.name || "", l.debit_cents ? (l.debit_cents / 100).toFixed(2) : "", l.credit_cents ? (l.credit_cents / 100).toFixed(2) : "", l.business_id ? biz.get(l.business_id) || "" : "", l.memo || e.memo || "", e.source_type]);
        }
      }
      downloadCsv(`journal-${from}-to-${to}.csv`, rows);
    } catch (e) { onError(e instanceof Error ? e.message : "Export failed."); }
    finally { setBusy(""); }
  }

  async function exportTrial() {
    setBusy("tb");
    try {
      const b = await balances(entity.id, null, to);
      downloadCsv(`trial-balance-${to}.csv`, [["Account Number", "Account", "Type", "Debit", "Credit"], ...b.filter((r) => Number(r.debit_cents) || Number(r.credit_cents)).map((r) => {
        const net = Number(r.debit_cents) - Number(r.credit_cents);
        return [r.code, r.name, r.type, net > 0 ? (net / 100).toFixed(2) : "", net < 0 ? (-net / 100).toFixed(2) : ""];
      })]);
    } catch (e) { onError(e instanceof Error ? e.message : "Export failed."); }
    finally { setBusy(""); }
  }

  return (
    <div className={styles.twoCol} style={{ marginTop: 0 }}>
      <article className={styles.card}>
        <h2>Close the month</h2>
        <p className={styles.muted}>Each month: review every bank transaction, check the bank balance matches the books, record any owner draws or loans, then close. Closed months can't be changed until reopened.</p>
        <ul className={styles.plainList}>
          {months.map((m) => (
            <li key={m.start} className={styles.reminderRow}>
              <div>
                <strong>{m.label}</strong>
                <small className={m.toReview ? styles.overdue : styles.muted}>{m.entries} entries{m.toReview ? ` · ${m.toReview} to review` : ""}{m.status === "closed" ? " · closed" : ""}</small>
              </div>
              {m.status === "closed"
                ? <button type="button" className={styles.linkButton} onClick={() => void setStatus(m, "open")}>Reopen</button>
                : m.start < `${officeToday().slice(0, 7)}-01` && <button type="button" className="button button-secondary" onClick={() => void setStatus(m, "closed")}>Close {m.label.split(" ")[0]}</button>}
            </li>
          ))}
        </ul>
      </article>
      <article className={styles.card}>
        <h2>Export for your CPA</h2>
        <p className={styles.muted}>CSV files your accountant can open in Excel or import into their own software (map the columns on import).</p>
        <div className={styles.formGrid}>
          <label className={styles.field}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className={styles.field}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
          <button type="button" className="button button-primary" disabled={!!busy} onClick={() => void exportJournal()}>{busy === "journal" ? "Preparing…" : "General journal CSV"}</button>
          <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void exportTrial()}>{busy === "tb" ? "Preparing…" : `Trial balance as of ${to}`}</button>
        </div>
        <small className={styles.muted}>Profit & loss, balance sheet and the other reports download from the Reports tab.</small>
      </article>
    </div>
  );
}
