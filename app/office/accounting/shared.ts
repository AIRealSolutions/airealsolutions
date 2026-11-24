"use client";

import { useCallback, useEffect, useState } from "react";
import { factoryToken } from "../../factory/connections/session";
import { officeRest, officeRpc, officeToday, OfficeError, SUPABASE_KEY, SUPABASE_URL } from "../lib/client";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
export type Account = { id: string; entity_id: string; code: string; name: string; type: AccountType; subtype: string; system_key: string | null; active: boolean };
export type Balance = { account_id: string; code: string; name: string; type: AccountType; subtype: string; debit_cents: number; credit_cents: number; balance_cents: number };
export type Entity = { id: string; legal_name: string; fiscal_year_start_month: number; settings: { mileage_rate_cents?: number } };

export const ACCOUNT_SELECT = "id,entity_id,code,name,type,subtype,system_key,active";
export const TYPE_LABEL: Record<AccountType, string> = { asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses" };
export const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
export const toCents = (v: string): number | null => {
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** The company and its chart of accounts. */
export function useLedger() {
  const [entity, setEntity] = useState<Entity | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    try {
      const [e, a] = await Promise.all([
        officeRest<Entity[]>("acct_entities?select=id,legal_name,fiscal_year_start_month,settings&limit=1"),
        officeRest<Account[]>(`acct_accounts?select=${ACCOUNT_SELECT}&order=code.asc`),
      ]);
      setEntity(e[0] ?? null);
      setAccounts(a);
      setError(a.length ? "" : "The chart of accounts is empty. Run docs/office-phase4.sql in Supabase.");
    } catch (err) {
      setError(err instanceof OfficeError && (err.code === "PGRST205" || err.code === "42P01")
        ? "The books are not set up yet. Run docs/office-phase4.sql in Supabase."
        : err instanceof Error ? err.message : "Could not load the books.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { entity, accounts, error, loading, reload };
}

export const balances = (entity: string, from: string | null, to: string, business?: string | null) =>
  officeRpc<Balance[]>("acct_balances", { p_entity: entity, p_from: from, p_to: to, p_business: business || null });

export const isCash = (a: { subtype: string }) => a.subtype === "bank" || a.subtype === "credit_card";
export const accountLabel = (a: Account) => `${a.code} · ${a.name}`;

// ---- periods ------------------------------------------------------------------------------
export type Range = { from: string; to: string; label: string };
export function presets(fyStartMonth = 1): Record<string, Range> {
  const today = officeToday();
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const fyY = m >= fyStartMonth ? y : y - 1;
  return {
    month: { from: `${y}-${pad(m)}-01`, to: today, label: "This month" },
    last_month: { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${lastDay(py, pm)}`, label: "Last month" },
    quarter: { from: `${y}-${pad(qStart)}-01`, to: today, label: "This quarter" },
    ytd: { from: `${fyY}-${pad(fyStartMonth)}-01`, to: today, label: "Year to date" },
    last_year: { from: `${fyY - 1}-${pad(fyStartMonth)}-01`, to: shift(`${fyY}-${pad(fyStartMonth)}-01`, -1), label: "Last year" },
  };
}
function shift(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- files --------------------------------------------------------------------------------
/** Upload a receipt to the private "receipts" bucket; returns its path. */
export async function uploadReceipt(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("Receipts must be under 10 MB.");
  const token = await factoryToken();
  if (!token) throw new Error("Sign in first.");
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+/, "").slice(-60) || "receipt";
  const path = `${officeToday().slice(0, 7).replace("-", "/")}/${crypto.randomUUID()}-${safe}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(d?.message || d?.error || `Upload failed (${r.status}).`);
  }
  return path;
}

/** A 10-minute link to view a private receipt. */
export async function receiptLink(path: string): Promise<string> {
  const token = await factoryToken();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/receipts/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.signedURL) throw new Error("Could not open the receipt.");
  return `${SUPABASE_URL}/storage/v1${d.signedURL}`;
}

/** Download rows as a CSV file. */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    // Leading = + - @ would be run as formulas by spreadsheet apps.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Minimal CSV parser (quotes, commas, newlines in quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Fetch every row of a PostgREST query in pages of 1,000 (Supabase's default row cap). */
export async function officeRestAll<T>(path: string, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < max; offset += 1000) {
    const page = await officeRest<T[]>(`${path}${path.includes("?") ? "&" : "?"}limit=1000&offset=${offset}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
