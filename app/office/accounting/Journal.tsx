"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag } from "../components";
import { officeRest, officeRpc, officeToday, prettyDate, type Business } from "../lib/client";
import { accountLabel, money, toCents, type Account } from "./shared";

type Entry = { id: string; entry_no: number; entry_date: string; memo: string | null; source_type: string; status: string; reversal_of: string | null };
type Line = { id: string; entry_id: string; account_id: string; debit_cents: number; credit_cents: number; business_id: string | null; memo: string | null };
const SOURCE_LABEL: Record<string, string> = { manual: "Manual", invoice: "Invoice", payment: "Payment", bill: "Bill", bill_payment: "Bill paid", expense: "Expense", bank_txn: "Bank" };

export function Journal({ entityId, accounts, businesses, onError }: { entityId: string; accounts: Account[]; businesses: Business[]; onError: (m: string) => void }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState(`${officeToday().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(officeToday());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [composing, setComposing] = useState(false);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const load = useCallback(async () => {
    try {
      let ids: string[] | null = null;
      if (account) ids = [...new Set((await officeRest<{ entry_id: string }[]>(`acct_journal_lines?account_id=eq.${account}&select=entry_id&limit=1000`)).map((l) => l.entry_id))];
      if (ids && !ids.length) { setEntries([]); setLines([]); return; }
      const e = await officeRest<Entry[]>(`acct_journal_entries?entity_id=eq.${entityId}&entry_date=gte.${from}&entry_date=lte.${to}${ids ? `&id=in.(${ids.slice(0, 300).join(",")})` : ""}&select=id,entry_no,entry_date,memo,source_type,status,reversal_of&order=entry_date.desc,entry_no.desc&limit=200`);
      setEntries(e);
      setLines(e.length ? await officeRest<Line[]>(`acct_journal_lines?entry_id=in.(${e.map((x) => x.id).join(",")})&select=id,entry_id,account_id,debit_cents,credit_cents,business_id,memo`) : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not load the journal.");
    }
  }, [entityId, account, from, to, onError]);
  useEffect(() => { void load(); }, [load]);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <>
      <div className={styles.toolbar} style={{ marginTop: 0 }}>
        <div className={styles.formGrid4} style={{ flex: 1 }}>
          <label className={`${styles.field} ${styles.span2}`}>Account
            <select value={account} onChange={(e) => setAccount(e.target.value)}>
              <option value="">All accounts</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
            </select>
          </label>
          <label className={styles.field}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className={styles.field}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        {!composing && <button className="button button-primary" onClick={() => setComposing(true)}>+ Manual entry</button>}
      </div>
      {composing && <ManualEntry entityId={entityId} accounts={accounts} businesses={businesses} onDone={async () => { setComposing(false); await load(); }} onCancel={() => setComposing(false)} onError={onError} />}

      {entries.length === 0 && <p className={styles.muted}>No entries in this range.</p>}
      {entries.length > 0 && (
        <div className={`${styles.card} ${styles.tableWrap}`}>
          <table className={styles.table}>
            <thead><tr><th>#</th><th>Date</th><th>Description</th><th>From</th><th className={styles.num}>Amount</th><th></th></tr></thead>
            <tbody>
              {entries.map((e) => {
                const ls = lines.filter((l) => l.entry_id === e.id);
                const amt = ls.reduce((n, l) => n + Number(l.debit_cents), 0);
                return [
                  <tr key={e.id} className={`${styles.rowLink} ${e.status === "reversed" ? styles.taskDone : ""}`} onClick={() => toggle(e.id)}>
                    <td>{e.entry_no}</td>
                    <td>{prettyDate(e.entry_date)}</td>
                    <td>{e.memo}{e.reversal_of && <small className={styles.muted}> (reversal)</small>}</td>
                    <td><span className={styles.statusPill}>{SOURCE_LABEL[e.source_type] || e.source_type}</span></td>
                    <td className={styles.num}>{money(amt)}</td>
                    <td>{e.source_type === "manual" && e.status === "posted" && !e.reversal_of && (
                      <button type="button" className={styles.linkButton} onClick={async (ev) => { ev.stopPropagation(); if (!window.confirm(`Reverse entry #${e.entry_no}? A reversing entry is posted; nothing is deleted.`)) return; try { await officeRpc("acct_reverse_entry", { p_entry: e.id }); await load(); } catch (err) { onError(err instanceof Error ? err.message : "Could not reverse."); } }}>Reverse</button>
                    )}</td>
                  </tr>,
                  open.has(e.id) && (
                    <tr key={`${e.id}-lines`}>
                      <td />
                      <td colSpan={5}>
                        <table className={styles.subTable}>
                          <tbody>
                            {ls.map((l) => (
                              <tr key={l.id}>
                                <td>{byId.get(l.account_id) ? accountLabel(byId.get(l.account_id)!) : "?"}</td>
                                <td><BizTag business={businesses.find((b) => b.id === l.business_id)} /></td>
                                <td className={styles.num}>{l.debit_cents ? money(l.debit_cents) : ""}</td>
                                <td className={styles.num}>{l.credit_cents ? money(l.credit_cents) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      <small className={styles.muted}>Click a row to see its debits and credits. Entries from invoices, bills and bank transactions change when you change those records.</small>
    </>
  );
}

type Draft = { key: number; account: string; business: string; debit: string; credit: string };
let seq = 0;
const blankLine = (): Draft => ({ key: seq++, account: "", business: "", debit: "", credit: "" });

function ManualEntry({ entityId, accounts, businesses, onDone, onCancel, onError }: {
  entityId: string; accounts: Account[]; businesses: Business[]; onDone: () => Promise<void>; onCancel: () => void; onError: (m: string) => void;
}) {
  const [date, setDate] = useState(officeToday());
  const [memo, setMemo] = useState("");
  const [rows, setRows] = useState<Draft[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const debits = rows.reduce((n, r) => n + (toCents(r.debit) || 0), 0);
  const credits = rows.reduce((n, r) => n + (toCents(r.credit) || 0), 0);
  const set = (key: number, patch: Partial<Draft>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function post() {
    const lines = rows.filter((r) => r.account && ((toCents(r.debit) || 0) > 0 || (toCents(r.credit) || 0) > 0))
      .map((r) => ({ account_id: r.account, business_id: r.business || null, debit: toCents(r.debit) || 0, credit: toCents(r.credit) || 0 }));
    if (lines.some((l) => l.debit && l.credit)) return onError("A line can have a debit or a credit, not both.");
    if (lines.length < 2 || debits !== credits || debits === 0) return onError("Debits and credits must be equal and above zero.");
    setBusy(true);
    try {
      await officeRpc("acct_post_manual", { p_entity: entityId, p_date: date, p_memo: memo, p_lines: lines });
      await onDone();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not post."); }
    finally { setBusy(false); }
  }

  return (
    <div className={`${styles.card} ${styles.addForm}`}>
      <h2>Manual journal entry</h2>
      <small className={styles.muted}>For opening balances, owner contributions or draws, loans, depreciation and corrections. Everything else posts on its own.</small>
      <div className={styles.formGrid4}>
        <label className={styles.field}>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className={`${styles.field} ${styles.span2}`}>Description<input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Opening balance, Jan 1" /></label>
      </div>
      <div className={styles.tableWrap}>
        <table className={`${styles.table} ${styles.linesTable}`}>
          <thead><tr><th>Account</th><th>Business line</th><th className={styles.num}>Debit ($)</th><th className={styles.num}>Credit ($)</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><select value={r.account} onChange={(e) => set(r.key, { account: e.target.value })} aria-label="Account" className={styles.cellSelect}>
                  <option value="">Choose…</option>
                  {accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                </select></td>
                <td><select value={r.business} onChange={(e) => set(r.key, { business: e.target.value })} aria-label="Business line" className={styles.cellSelect}>
                  <option value="">General</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select></td>
                <td className={styles.num}><input className={styles.price} inputMode="decimal" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value, credit: e.target.value ? "" : r.credit })} aria-label="Debit" /></td>
                <td className={styles.num}><input className={styles.price} inputMode="decimal" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value, debit: e.target.value ? "" : r.debit })} aria-label="Credit" /></td>
                <td>{rows.length > 2 && <button type="button" className={styles.iconButton} aria-label="Remove line" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className={styles.totalRow}><td colSpan={2} className={styles.num}>{debits === credits ? "Balanced" : `Off by ${money(Math.abs(debits - credits))}`}</td><td className={styles.num}>{money(debits)}</td><td className={styles.num}>{money(credits)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
      <div className={styles.rowEnd}>
        <button type="button" className={styles.linkButton} onClick={() => setRows([...rows, blankLine()])}>+ Line</button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>Cancel</button>
        <button type="button" className="button button-primary" disabled={busy || debits !== credits || debits === 0} onClick={() => void post()}>{busy ? "Posting…" : "Post entry"}</button>
      </div>
    </div>
  );
}
