"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect } from "../components";
import { api } from "../../factory/connections/session";
import { officeInsert, officePatch, officeRest, prettyDate, prettyDateTime, type Business } from "../lib/client";
import { accountLabel, money, parseCsv, type Account } from "./shared";

type BankAccount = { id: string; connection_id: string | null; ledger_account_id: string; name: string; mask: string | null; kind: "bank" | "credit_card"; current_balance_cents: number | null; active: boolean };
type Connection = { id: string; institution_name: string | null; status: string; last_synced_at: string | null; last_error: string | null };
type Txn = {
  id: string; bank_account_id: string; posted_on: string; amount_cents: number; description: string; merchant: string | null; pending: boolean;
  status: "new" | "categorized" | "matched" | "excluded"; category_account_id: string | null; business_id: string | null; memo: string | null;
  matched_type: string | null; suggested_account_id: string | null; suggested_business_id: string | null; suggestion_source: string | null; suggestion_note: string | null;
};
type Candidate = { type: "payment" | "bill" | "expense"; id: string; label: string; date: string; amount_cents: number };
const TXN_SELECT = "id,bank_account_id,posted_on,amount_cents,description,merchant,pending,status,category_account_id,business_id,memo,matched_type,suggested_account_id,suggested_business_id,suggestion_source,suggestion_note";

declare global {
  interface Window { Plaid?: { create: (o: { token: string; onSuccess: (publicToken: string, meta: { institution?: { name?: string } | null }) => void; onExit?: (err: unknown) => void }) => { open: () => void } } }
}

export function Banking({ entityId, accounts, businesses, onAccountsChanged, onError }: {
  entityId: string; accounts: Account[]; businesses: Business[]; onAccountsChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [conns, setConns] = useState<Connection[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [view, setView] = useState<"new" | "pending" | "done">("new");
  const [plaid, setPlaid] = useState<{ configured: boolean; env: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [showImport, setShowImport] = useState(false);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const load = useCallback(async () => {
    try {
      const filter = view === "new" ? "status=eq.new&pending=eq.false" : view === "pending" ? "pending=eq.true" : "status=in.(categorized,matched,excluded)";
      const [b, c, t] = await Promise.all([
        officeRest<BankAccount[]>("acct_bank_accounts?select=id,connection_id,ledger_account_id,name,mask,kind,current_balance_cents,active&order=name.asc"),
        officeRest<Connection[]>("acct_bank_connections?select=id,institution_name,status,last_synced_at,last_error&order=created_at.asc"),
        officeRest<Txn[]>(`acct_bank_txns?${filter}&select=${TXN_SELECT}&order=posted_on.desc&limit=${view === "done" ? 150 : 300}`),
      ]);
      setBanks(b); setConns(c); setTxns(t);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not load banking.");
    }
  }, [view, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { fetch("/api/office/plaid/link-token").then((r) => r.json()).then(setPlaid, () => setPlaid(null)); }, []);

  async function connect() {
    setBusy("connect");
    setMsg("");
    try {
      if (!window.Plaid) {
        await new Promise<void>((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          s.onload = () => res();
          s.onerror = () => rej(new Error("Could not load Plaid."));
          document.head.appendChild(s);
        });
      }
      const { link_token } = await api<{ link_token: string }>("/api/office/plaid/link-token", { method: "POST", body: "{}" });
      window.Plaid!.create({
        token: link_token,
        onSuccess: async (public_token, meta) => {
          setBusy("connect");
          try {
            const r = await api<{ accounts: { name: string; ledger_code: string }[] }>("/api/office/plaid/exchange", { method: "POST", body: JSON.stringify({ public_token, institution_name: meta.institution?.name || "Bank" }) });
            setMsg(`Connected: ${r.accounts.map((a) => `${a.name} → ${a.ledger_code}`).join("; ") || "no new accounts"}.`);
            await onAccountsChanged();
            await load();
          } catch (e) { onError(e instanceof Error ? e.message : "Could not finish connecting."); }
          finally { setBusy(""); }
        },
        onExit: () => setBusy(""),
      }).open();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not start Plaid.");
      setBusy("");
    }
  }

  async function sync() {
    setBusy("sync");
    setMsg("");
    try {
      const r = await api<{ added: number; updated: number; removed: number; errors: string[]; byRule: number; byAi: number }>("/api/office/plaid/sync", { method: "POST", body: "{}" });
      setMsg(`${r.added} new transaction${r.added === 1 ? "" : "s"}; ${r.byRule + r.byAi} suggested.${r.errors.length ? ` Problems: ${r.errors.join("; ")}` : ""}`);
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Sync failed."); }
    finally { setBusy(""); }
  }

  async function suggest() {
    setBusy("suggest");
    try {
      const r = await api<{ byRule: number; byAi: number; ai: boolean }>("/api/office/accounting/suggest", { method: "POST", body: "{}" });
      setMsg(`${r.byRule} suggested by your rules, ${r.byAi} by the Bookkeeper Agent${r.ai ? "" : " (AI is off)"}.`);
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not get suggestions."); }
    finally { setBusy(""); }
  }

  async function acceptAll() {
    const ready = txns.filter((t) => t.status === "new" && t.suggested_account_id);
    if (!ready.length || !window.confirm(`Post ${ready.length} suggested categor${ready.length === 1 ? "y" : "ies"} to the books?`)) return;
    setBusy("accept");
    try {
      for (const t of ready) await officePatch("acct_bank_txns", `id=eq.${t.id}&status=eq.new`, { status: "categorized", category_account_id: t.suggested_account_id, business_id: t.suggested_business_id });
      setMsg(`Posted ${ready.length}.`);
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not post them all."); await load(); }
    finally { setBusy(""); }
  }

  const bankName = (id: string) => banks.find((b) => b.id === id)?.name || "Account";
  const withSuggestion = txns.filter((t) => t.status === "new" && t.suggested_account_id).length;

  return (
    <>
      <div className={styles.twoCol} style={{ marginTop: 0 }}>
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Bank & card accounts</h2>
            <div className={styles.rowActions}>
              {conns.length > 0 && <button className="button button-secondary" disabled={!!busy} onClick={() => void sync()}>{busy === "sync" ? "Syncing…" : "Sync now"}</button>}
              {plaid?.configured && <button className="button button-primary" disabled={!!busy} onClick={() => void connect()}>{busy === "connect" ? "Connecting…" : "Connect a bank"}</button>}
            </div>
          </div>
          {plaid && !plaid.configured && <small className={styles.muted}>Bank feeds need Plaid keys (PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV) in Vercel. Until then, import CSV statements.</small>}
          {plaid?.configured && plaid.env === "sandbox" && <small className={styles.muted}>Plaid is in sandbox mode (test banks only). Switch PLAID_ENV to production for real accounts.</small>}
          <ul className={styles.plainList}>
            {banks.length === 0 && <li className={styles.muted}>No accounts linked yet.</li>}
            {banks.map((b) => {
              const c = conns.find((x) => x.id === b.connection_id);
              return (
                <li key={b.id} className={styles.reminderRow}>
                  <div>
                    <strong>{b.name}</strong>
                    <small className={c?.last_error ? styles.overdue : styles.muted}>
                      {byId.get(b.ledger_account_id) ? accountLabel(byId.get(b.ledger_account_id)!) : ""}
                      {c ? ` · ${c.last_error ? `Sync problem: ${c.last_error}` : c.last_synced_at ? `synced ${prettyDateTime(c.last_synced_at)}` : "not synced yet"}` : " · CSV import"}
                    </small>
                  </div>
                  {b.current_balance_cents != null && <span>Bank says {money(b.kind === "credit_card" ? b.current_balance_cents : b.current_balance_cents)}</span>}
                </li>
              );
            })}
          </ul>
          <button type="button" className={styles.linkButton} onClick={() => setShowImport(!showImport)}>{showImport ? "Hide CSV import" : "Import a CSV statement…"}</button>
          {showImport && <CsvImport entityId={entityId} banks={banks} accounts={accounts} onDone={async (m) => { setMsg(m); setShowImport(false); await load(); }} onError={onError} />}
        </article>
        <article className={styles.card}>
          <h2>How review works</h2>
          <ul className={styles.list}>
            <li>Each transaction gets a suggested category from your saved rules, or from the Bookkeeper Agent.</li>
            <li><strong>Save</strong> posts it to the books. Tick <em>Remember</em> to auto-suggest the same category for that vendor next time.</li>
            <li><strong>Match</strong> links it to a payment, bill or expense already recorded, so nothing is counted twice.</li>
            <li>Stripe payouts go to <em>Stripe clearing</em>; transfers between your accounts go to the other account; transfers to you are Owner draws.</li>
          </ul>
        </article>
      </div>
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Show">
          {([["new", "To review"], ["pending", "Pending"], ["done", "Done"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={view === v} className={view === v ? styles.seg_focus : undefined} onClick={() => setView(v)}>{l}</button>)}
        </div>
        {view === "new" && (
          <div className={styles.rowActions}>
            <button className="button button-secondary" disabled={!!busy} onClick={() => void suggest()}>{busy === "suggest" ? "Thinking…" : "Suggest categories"}</button>
            {withSuggestion > 0 && <button className="button button-primary" disabled={!!busy} onClick={() => void acceptAll()}>{busy === "accept" ? "Posting…" : `Accept ${withSuggestion} suggestion${withSuggestion === 1 ? "" : "s"}`}</button>}
          </div>
        )}
      </div>
      {txns.length === 0 && <p className={styles.muted}>{view === "new" ? "Nothing to review." : "Nothing here."}</p>}
      <ul className={styles.feedList}>
        {txns.map((t) => <TxnRow key={t.id} t={t} bank={banks.find((b) => b.id === t.bank_account_id)} bankName={bankName(t.bank_account_id)} entityId={entityId} accounts={accounts} businesses={businesses} onChanged={load} onError={onError} />)}
      </ul>
    </>
  );
}

function TxnRow({ t, bank, bankName, entityId, accounts, businesses, onChanged, onError }: {
  t: Txn; bank?: BankAccount; bankName: string; entityId: string; accounts: Account[]; businesses: Business[]; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [account, setAccount] = useState(t.category_account_id || t.suggested_account_id || "");
  const [business, setBusiness] = useState(t.business_id || t.suggested_business_id || "");
  const [remember, setRemember] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const acc = accounts.find((a) => a.id === (t.category_account_id || ""));
  const vendorKey = (t.merchant || t.description.split(/\s+/).slice(0, 3).join(" ")).trim().slice(0, 60);
  const choices = accounts.filter((a) => a.active && a.id !== bank?.ledger_account_id && a.system_key !== "ar" && a.system_key !== "ap");

  async function save() {
    if (!account) return onError("Choose a category.");
    setBusy(true);
    try {
      await officePatch("acct_bank_txns", `id=eq.${t.id}`, { status: "categorized", category_account_id: account, business_id: business || null });
      if (remember && vendorKey.length >= 3) {
        await officeRest("acct_rules?on_conflict=entity_id,match_text", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ entity_id: entityId, match_text: vendorKey.toLowerCase(), account_id: account, business_id: business || null }) });
      }
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(false); }
  }
  async function findMatches() {
    const amt = Math.abs(t.amount_cents);
    const from = new Date(Date.parse(`${t.posted_on}T12:00:00Z`) - 10 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.parse(`${t.posted_on}T12:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    try {
      const taken = new Set((await officeRest<{ matched_id: string }[]>("acct_bank_txns?status=eq.matched&select=matched_id")).map((x) => x.matched_id));
      const list: Candidate[] = [];
      if (t.amount_cents > 0) {
        const pays = await officeRest<{ id: string; amount_cents: number; received_on: string; method: string; bill_invoices: { number: string } | null }[]>(
          `bill_payments?amount_cents=eq.${amt}&method=neq.stripe&received_on=gte.${from}&received_on=lte.${to}&select=id,amount_cents,received_on,method,bill_invoices(number)`);
        list.push(...pays.map((p) => ({ type: "payment" as const, id: p.id, label: `Payment on ${p.bill_invoices?.number} (${p.method})`, date: p.received_on, amount_cents: p.amount_cents })));
      } else {
        const [bills, exps] = await Promise.all([
          officeRest<{ id: string; vendor: string; bill_date: string; amount_cents: number }[]>(`acct_bills?status=eq.open&amount_cents=eq.${amt}&select=id,vendor,bill_date,amount_cents`),
          officeRest<{ id: string; vendor: string; spent_on: string; amount_cents: number }[]>(`acct_expenses?amount_cents=eq.${amt}&spent_on=gte.${from}&spent_on=lte.${to}${bank ? `&paid_from_account_id=eq.${bank.ledger_account_id}` : ""}&select=id,vendor,spent_on,amount_cents`),
        ]);
        list.push(...bills.map((b) => ({ type: "bill" as const, id: b.id, label: `Open bill: ${b.vendor}`, date: b.bill_date, amount_cents: b.amount_cents })));
        list.push(...exps.map((x) => ({ type: "expense" as const, id: x.id, label: `Expense: ${x.vendor}`, date: x.spent_on, amount_cents: x.amount_cents })));
      }
      setCandidates(list.filter((c) => !taken.has(c.id)));
    } catch (e) { onError(e instanceof Error ? e.message : "Could not look for matches."); }
  }
  async function match(c: Candidate) {
    if (!bank) return;
    setBusy(true);
    try {
      if (c.type === "payment") await officePatch("bill_payments", `id=eq.${c.id}`, { deposit_account_id: bank.ledger_account_id });
      if (c.type === "bill") await officePatch("acct_bills", `id=eq.${c.id}`, { status: "paid", paid_on: t.posted_on, paid_from_account_id: bank.ledger_account_id });
      await officePatch("acct_bank_txns", `id=eq.${t.id}`, { status: "matched", matched_type: c.type, matched_id: c.id });
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not match."); }
    finally { setBusy(false); }
  }
  async function undo() {
    setBusy(true);
    try { await officePatch("acct_bank_txns", `id=eq.${t.id}`, { status: "new", category_account_id: null, matched_type: null, matched_id: null }); await onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not undo."); }
    finally { setBusy(false); }
  }

  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <strong>{t.merchant || t.description}</strong>
          <span className={styles.taskMeta}>
            <small className={styles.muted}>{prettyDate(t.posted_on)} · {bankName}{t.merchant ? ` · ${t.description}` : ""}</small>
            {t.pending && <small className={styles.muted}>pending</small>}
          </span>
        </div>
        <strong className={t.amount_cents > 0 ? styles.moneyIn : undefined}>{t.amount_cents > 0 ? "+" : "−"}{money(Math.abs(t.amount_cents))}</strong>
      </div>
      {t.status === "new" && !t.pending && (
        <>
          {t.suggested_account_id && <small className={styles.muted}>Suggested{t.suggestion_source === "ai" ? " by the Bookkeeper Agent" : ""}: {accounts.find((a) => a.id === t.suggested_account_id)?.name}{t.suggestion_note ? ` — ${t.suggestion_note}` : ""}</small>}
          <div className={styles.formGrid4}>
            <label className={`${styles.field} ${styles.span2}`}>Category
              <select value={account} onChange={(e) => setAccount(e.target.value)}>
                <option value="">Choose…</option>
                {(["income", "expense", "asset", "liability", "equity"] as const).map((ty) => (
                  <optgroup key={ty} label={ty[0].toUpperCase() + ty.slice(1)}>
                    {choices.filter((a) => a.type === ty).map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="Business line" noneLabel="General" />
            <label className={styles.check} style={{ alignSelf: "end" }}><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember for “{vendorKey}”</label>
          </div>
          <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
            <button type="button" className="button button-primary" disabled={busy || !account} onClick={() => void save()}>Save</button>
            <button type="button" className="button button-secondary" disabled={busy} onClick={() => void findMatches()}>Match…</button>
            <button type="button" className={styles.linkButton} disabled={busy} onClick={async () => { await officePatch("acct_bank_txns", `id=eq.${t.id}`, { status: "excluded" }); await onChanged(); }}>Exclude</button>
          </div>
          {candidates && (
            <div className={styles.proposal}>
              {candidates.length === 0 && <small className={styles.muted}>No recorded payment, bill or expense with this amount nearby. Categorize it instead.</small>}
              {candidates.map((c) => (
                <div key={c.id} className={styles.reminderRow}>
                  <span>{c.label} · {prettyDate(c.date)} · {money(c.amount_cents)}</span>
                  <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void match(c)}>Match</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {t.status !== "new" && (
        <div className={styles.rowActions} style={{ justifyContent: "space-between" }}>
          <span className={styles.taskMeta}>
            <small className={styles.muted}>{t.status === "categorized" ? `Posted to ${acc?.name}` : t.status === "matched" ? `Matched to a ${t.matched_type}` : "Excluded"}</small>
            <BizTag business={businesses.find((b) => b.id === t.business_id)} />
          </span>
          <button type="button" className={styles.linkButton} disabled={busy} onClick={() => void undo()}>Undo</button>
        </div>
      )}
    </li>
  );
}

function CsvImport({ entityId, banks, accounts, onDone, onError }: { entityId: string; banks: BankAccount[]; accounts: Account[]; onDone: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [bankId, setBankId] = useState(banks[0]?.id || "new");
  const [newName, setNewName] = useState("");
  const [ledger, setLedger] = useState(accounts.find((a) => a.system_key === "checking")?.id || "");
  const [sign, setSign] = useState<"deposits_positive" | "withdrawals_positive">("deposits_positive");
  const [rows, setRows] = useState<{ date: string; description: string; cents: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [fileKey, setFileKey] = useState(0);
  const cashAccounts = accounts.filter((a) => a.subtype === "bank" || a.subtype === "credit_card");

  function parse(text: string) {
    const all = parseCsv(text);
    if (all.length < 2) return onError("That file has no rows.");
    const head = all[0].map((h) => h.toLowerCase().trim());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const di = col("date"), de = col("description", "memo", "payee", "name", "details"), am = col("amount"), dr = col("debit", "withdrawal"), cr = col("credit", "deposit");
    if (di < 0 || de < 0 || (am < 0 && dr < 0 && cr < 0)) return onError("Couldn't find Date, Description and Amount (or Debit/Credit) columns.");
    const num = (s: string | undefined) => { const v = Number(String(s || "").replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1")); return Number.isFinite(v) ? v : 0; };
    const date = (s: string) => {
      const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/) || s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
      if (!m) return "";
      if (s.includes("/")) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
      return `${m[1]}-${m[2]}-${m[3]}`;
    };
    const out = all.slice(1).map((r) => {
      let v = am >= 0 ? num(r[am]) : num(r[cr]) - num(r[dr]);
      if (am >= 0 && sign === "withdrawals_positive") v = -v;
      return { date: date(r[di] || ""), description: (r[de] || "").trim().slice(0, 300), cents: Math.round(v * 100) };
    }).filter((r) => r.date && r.cents !== 0);
    setRows(out);
  }

  async function run() {
    setBusy(true);
    try {
      let target = bankId;
      if (target === "new") {
        if (!newName.trim() || !ledger) throw new Error("Name the account and pick its ledger account.");
        const kind = accounts.find((a) => a.id === ledger)?.subtype === "credit_card" ? "credit_card" : "bank";
        target = (await officeInsert<{ id: string }>("acct_bank_accounts", { entity_id: entityId, ledger_account_id: ledger, name: newName.trim(), kind })).id;
      }
      const seen = new Map<string, number>();
      const payload = rows.map((r) => {
        const base = `${target}|${r.date}|${r.cents}|${r.description.toLowerCase()}`;
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        return { entity_id: entityId, bank_account_id: target, posted_on: r.date, amount_cents: r.cents, description: r.description, dedupe_key: `${base}|${n}` };
      });
      const ins = await officeRest<{ id: string }[]>("acct_bank_txns?on_conflict=dedupe_key&select=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(payload) });
      await api("/api/office/accounting/suggest", { method: "POST", body: "{}" }).catch(() => undefined);
      await onDone(`Imported ${ins.length} new transaction${ins.length === 1 ? "" : "s"} (${payload.length - ins.length} already imported).`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.proposal} style={{ marginTop: 10 }}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Into
          <select value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            <option value="new">A new account…</option>
          </select>
        </label>
        {bankId === "new" && <label className={styles.field}>Account name<input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="First Bank checking" /></label>}
        {bankId === "new" && (
          <label className={styles.field}>Books account
            <select value={ledger} onChange={(e) => setLedger(e.target.value)}>{cashAccounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}</select>
          </label>
        )}
        <label className={styles.field}>Amounts in the file
          <select value={sign} onChange={(e) => { setSign(e.target.value as typeof sign); setRows([]); setFileKey((k) => k + 1); }}>
            <option value="deposits_positive">Deposits positive, withdrawals negative</option>
            <option value="withdrawals_positive">Charges positive (most credit cards)</option>
          </select>
        </label>
        <label className={styles.field}>CSV file<input key={fileKey} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) parse(await f.text()); }} /></label>
      </div>
      {rows.length > 0 && <small className={styles.muted}>{rows.length} transactions found, {rows[rows.length - 1]?.date} to {rows[0]?.date}. Re-importing the same file is safe.</small>}
      <div className={styles.rowEnd}><button type="button" className="button button-primary" disabled={busy || !rows.length} onClick={() => void run()}>{busy ? "Importing…" : "Import"}</button></div>
    </div>
  );
}
