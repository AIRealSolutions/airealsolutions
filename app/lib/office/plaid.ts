// Plaid bank feeds: Link token, token exchange, account mapping and transaction sync. Server-only.
// Access tokens are stored encrypted (INTEGRATIONS_ENCRYPTION_KEY) and never sent to the browser.
import { decryptJson, encryptJson, HttpError } from "../integrations/server";
import type { Rest } from "./server";

export const plaidConfigured = () => Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
const base = () => {
  const env = (process.env.PLAID_ENV || "sandbox").toLowerCase();
  if (!["sandbox", "production"].includes(env)) throw new HttpError(503, "PLAID_ENV must be sandbox or production.");
  return `https://${env}.plaid.com`;
};

async function plaid<T>(path: string, body: object): Promise<T> {
  if (!plaidConfigured()) throw new HttpError(503, "Bank feeds are not set up yet (PLAID_CLIENT_ID and PLAID_SECRET).");
  const r = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: process.env.PLAID_CLIENT_ID, secret: process.env.PLAID_SECRET, ...body }),
    cache: "no-store",
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new HttpError(r.status >= 500 ? 502 : 400, `Plaid: ${data?.display_message || data?.error_message || `request failed (${r.status})`}`);
    (e as HttpError & { code?: string }).code = data?.error_code;
    throw e;
  }
  return data as T;
}

export async function createLinkToken(userId: string) {
  const r = await plaid<{ link_token: string }>("/link/token/create", {
    client_name: "AI Real Solutions Office",
    user: { client_user_id: userId },
    products: ["transactions"],
    transactions: { days_requested: 730 },
    country_codes: ["US"],
    language: "en",
  });
  return r.link_token;
}

type PlaidAccount = { account_id: string; name: string; official_name?: string | null; mask: string | null; type: string; subtype: string | null; balances?: { current: number | null } };
type Ledger = { id: string; code: string; system_key: string | null; subtype: string };

/** Exchange the Link public token, store the connection, and map each account to a ledger account. */
export async function connectBank(rest: Rest, entityId: string, publicToken: string, institution: string) {
  const ex = await plaid<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
  const acc = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token: ex.access_token });
  const conn = (await rest<{ id: string }[]>("acct_bank_connections?on_conflict=item_id&select=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ entity_id: entityId, institution_name: institution.slice(0, 120), item_id: ex.item_id, access_token_ciphertext: encryptJson({ access_token: ex.access_token }), status: "active", last_error: null }),
  }))[0];

  const [ledger, linked] = await Promise.all([
    rest<Ledger[]>(`acct_accounts?entity_id=eq.${entityId}&select=id,code,system_key,subtype`),
    rest<{ ledger_account_id: string; plaid_account_id: string | null }[]>(`acct_bank_accounts?entity_id=eq.${entityId}&select=ledger_account_id,plaid_account_id`),
  ]);
  const used = new Set(linked.map((l) => l.ledger_account_id));
  const codes = new Set(ledger.map((l) => l.code));
  const freeCode = (from: number, to: number) => { for (let c = from; c <= to; c++) if (!codes.has(String(c))) { codes.add(String(c)); return String(c); } throw new HttpError(409, "No free account numbers left in that range."); };

  const mapped: { name: string; ledger_code: string }[] = [];
  for (const a of acc.accounts) {
    if (a.type !== "depository" && a.type !== "credit") continue;
    if (linked.some((l) => l.plaid_account_id === a.account_id)) continue;
    const kind = a.type === "credit" ? "credit_card" : "bank";
    const label = `${institution} ${a.name}${a.mask ? ` ••${a.mask}` : ""}`.slice(0, 120);
    // The first bank account takes over "Business checking", the first card "Business credit card".
    let target = ledger.find((l) => l.system_key === (kind === "bank" ? "checking" : "credit_card") && !used.has(l.id));
    if (!target) {
      const created = (await rest<Ledger[]>("acct_accounts?select=id,code,system_key,subtype", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ entity_id: entityId, code: kind === "bank" ? freeCode(1001, 1049) : freeCode(2101, 2199), name: label, type: kind === "bank" ? "asset" : "liability", subtype: kind }),
      }))[0];
      target = created;
    } else {
      await rest(`acct_accounts?id=eq.${target.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ name: label }) });
    }
    used.add(target.id);
    await rest("acct_bank_accounts", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        entity_id: entityId, connection_id: conn.id, ledger_account_id: target.id, plaid_account_id: a.account_id, name: label, mask: a.mask, kind,
        current_balance_cents: a.balances?.current != null ? Math.round(a.balances.current * 100) : null,
      }),
    });
    mapped.push({ name: label, ledger_code: target.code });
  }
  return { connection_id: conn.id, accounts: mapped };
}

type PTxn = { transaction_id: string; account_id: string; amount: number; date: string; name: string; merchant_name?: string | null; pending: boolean; personal_finance_category?: { primary?: string; detailed?: string } | null };
type SyncPage = { added: PTxn[]; modified: PTxn[]; removed: { transaction_id: string }[]; next_cursor: string; has_more: boolean; accounts?: PlaidAccount[] };

/** Pull new, changed and removed transactions for every active connection. */
export async function syncBanks(rest: Rest) {
  const conns = await rest<{ id: string; entity_id: string; access_token_ciphertext: string; sync_cursor: string | null; institution_name: string | null }[]>(
    "acct_bank_connections?status=in.(active,error)&select=id,entity_id,access_token_ciphertext,sync_cursor,institution_name",
  );
  let added = 0, updated = 0, removed = 0;
  const errors: string[] = [];
  for (const c of conns) {
    try {
      const { access_token } = decryptJson<{ access_token: string }>(c.access_token_ciphertext);
      const accounts = await rest<{ id: string; plaid_account_id: string }[]>(`acct_bank_accounts?connection_id=eq.${c.id}&active=eq.true&select=id,plaid_account_id`);
      const byPlaid = new Map(accounts.map((a) => [a.plaid_account_id, a.id]));
      let cursor = c.sync_cursor || undefined;
      const all: SyncPage = { added: [], modified: [], removed: [], next_cursor: cursor || "", has_more: true };
      for (let page = 0, restarts = 0; all.has_more && page < 40; page++) {
        try {
          const p = await plaid<SyncPage>("/transactions/sync", { access_token, cursor, count: 500 });
          all.added.push(...p.added); all.modified.push(...p.modified); all.removed.push(...p.removed);
          all.next_cursor = p.next_cursor; all.has_more = p.has_more; cursor = p.next_cursor;
          if (p.accounts) all.accounts = p.accounts;
        } catch (e) {
          // Plaid asks to restart the whole sync if data changed mid-way.
          if ((e as { code?: string }).code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" && restarts++ < 2) {
            cursor = c.sync_cursor || undefined; all.added = []; all.modified = []; all.removed = []; continue;
          }
          throw e;
        }
      }
      const row = (t: PTxn) => ({
        entity_id: c.entity_id, bank_account_id: byPlaid.get(t.account_id), plaid_txn_id: t.transaction_id, posted_on: t.date,
        amount_cents: -Math.round(t.amount * 100), description: t.name.slice(0, 300), merchant: t.merchant_name || null,
        plaid_category: t.personal_finance_category?.detailed || t.personal_finance_category?.primary || null, pending: t.pending,
      });
      const fresh = all.added.filter((t) => byPlaid.has(t.account_id) && Math.round(t.amount * 100) !== 0).map(row);
      if (fresh.length) {
        const ins = await rest<{ id: string }[]>("acct_bank_txns?on_conflict=plaid_txn_id&select=id", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(fresh) });
        added += ins.length;
      }
      for (const t of all.modified.filter((x) => byPlaid.has(x.account_id))) {
        // Only transactions still waiting for review are updated; categorized ones keep what was booked.
        const r = row(t);
        await rest(`acct_bank_txns?plaid_txn_id=eq.${encodeURIComponent(t.transaction_id)}&status=eq.new`, {
          method: "PATCH", headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ posted_on: r.posted_on, amount_cents: r.amount_cents || 1, description: r.description, merchant: r.merchant, pending: r.pending }),
        });
        updated++;
      }
      if (all.removed.length) {
        const ids = all.removed.map((r) => `"${r.transaction_id.replace(/"/g, "")}"`).join(",");
        await rest(`acct_bank_txns?plaid_txn_id=in.(${ids})&status=in.(new,excluded)`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        removed += all.removed.length;
      }
      for (const a of all.accounts || []) {
        if (byPlaid.has(a.account_id) && a.balances?.current != null) {
          await rest(`acct_bank_accounts?plaid_account_id=eq.${encodeURIComponent(a.account_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ current_balance_cents: Math.round(a.balances.current * 100) }) });
        }
      }
      await rest(`acct_bank_connections?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sync_cursor: all.next_cursor, last_synced_at: new Date().toISOString(), status: "active", last_error: null }) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sync failed.";
      errors.push(`${c.institution_name || "Bank"}: ${msg}`);
      await rest(`acct_bank_connections?id=eq.${c.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "error", last_error: msg.slice(0, 300) }) }).catch(() => undefined);
    }
  }
  return { connections: conns.length, added, updated, removed, errors };
}
