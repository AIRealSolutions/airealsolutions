"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { officeInsert, officePatch, officeToday } from "../lib/client";
import { balances, money, TYPE_LABEL, type Account, type AccountType, type Balance } from "./shared";

const SUBTYPES: Record<AccountType, [string, string][]> = {
  asset: [["bank", "Bank account"], ["clearing", "Clearing"], ["fixed_asset", "Equipment"], ["other", "Other asset"]],
  liability: [["credit_card", "Credit card"], ["loan", "Loan"], ["tax", "Tax"], ["other", "Other liability"]],
  equity: [["owner", "Owner contributions"], ["owner_draw", "Owner draws"], ["other", "Other equity"]],
  income: [["revenue", "Revenue"], ["other_income", "Other income"]],
  expense: [["expense", "Operating expense"], ["cost_of_sales", "Cost of sales"], ["contractor", "Contractors (1099)"]],
};

export function Accounts({ entityId, accounts, onChanged, onError }: { entityId: string; accounts: Account[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [bal, setBal] = useState<Balance[]>([]);
  const [type, setType] = useState<AccountType>("expense");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [subtype, setSubtype] = useState("expense");
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    try { setBal(await balances(entityId, null, officeToday())); } catch (e) { onError(e instanceof Error ? e.message : "Could not load balances."); }
  }, [entityId, onError]);
  useEffect(() => { void load(); }, [load, accounts]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{3,6}$/.test(code)) return onError("Account numbers are 3-6 digits (e.g. 6550).");
    if (accounts.some((a) => a.code === code)) return onError(`Account ${code} already exists.`);
    try {
      await officeInsert("acct_accounts", { entity_id: entityId, code, name: name.trim(), type, subtype });
      setCode(""); setName("");
      await onChanged();
    } catch (err) { onError(err instanceof Error ? err.message : "Could not add the account."); }
  }

  return (
    <>
      <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Type
            <select value={type} onChange={(e) => { const t = e.target.value as AccountType; setType(t); setSubtype(SUBTYPES[t][0][0]); }}>
              {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className={styles.field}>Kind
            <select value={subtype} onChange={(e) => setSubtype(e.target.value)}>{SUBTYPES[type].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className={styles.field}>Number<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="6550" required /></label>
          <label className={styles.field}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Conferences" required /></label>
        </div>
        <div className={styles.rowEnd}><button className="button button-primary" type="submit">Add account</button></div>
      </form>
      <label className={styles.check}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived accounts</label>
      {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => {
        const list = accounts.filter((a) => a.type === t && (showArchived || a.active));
        return (
          <div key={t} className={styles.group}>
            <h2 className={styles.sectionTitle}>{TYPE_LABEL[t]}</h2>
            <div className={`${styles.card} ${styles.tableWrap}`}>
              <table className={styles.table}>
                <tbody>
                  {list.map((a) => {
                    const b = bal.find((x) => x.account_id === a.id)?.balance_cents || 0;
                    return (
                      <tr key={a.id} className={a.active ? undefined : styles.taskDone}>
                        <td style={{ width: 80 }}>{a.code}</td>
                        <td><strong>{a.name}</strong>{a.system_key && <small className={styles.muted}> · used by the Office</small>}</td>
                        <td className={styles.num}>{money(b)}</td>
                        <td style={{ width: 90 }}>{!a.system_key && (
                          <button type="button" className={styles.linkButton} onClick={async () => {
                            if (a.active && b !== 0 && !window.confirm(`${a.name} still has a balance of ${money(b)}. Archive anyway?`)) return;
                            try { await officePatch("acct_accounts", `id=eq.${a.id}`, { active: !a.active }); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Could not update."); }
                          }}>{a.active ? "Archive" : "Restore"}</button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}
