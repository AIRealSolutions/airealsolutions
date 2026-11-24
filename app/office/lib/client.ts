// Browser helpers for the Office. Calls Supabase as the signed-in user, so row-level security
// (admin-only on every office_* / acct_* table) decides what comes back.
import { factoryToken } from "../../factory/connections/session";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
export const SESSION_KEY = "airealsolutions.factory.session.v1";

export type Business = {
  id: string;
  entity_id: string;
  name: string;
  slug: string;
  relationship: "parent" | "venture" | "client";
  category: string | null;
  status: "focus" | "active" | "parked";
  website: string | null;
  summary: string | null;
  weekly_focus: string | null;
  factory_project_id: string | null;
  sort_order: number;
};

export type Entity = { id: string; legal_name: string; short_name: string; state: string };

export class OfficeError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** PostgREST request (path after /rest/v1/) as the signed-in user. */
export async function officeRest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await factoryToken();
  if (!token) throw new OfficeError(401, "Sign in first.");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) {
    // 42P01 / PGRST205: the table does not exist yet (phase-0 migration not applied).
    const missing = data?.code === "42P01" || data?.code === "PGRST205";
    throw new OfficeError(
      r.status,
      missing ? "The Office tables are not in the database yet. Apply docs/office-phase0.sql." : data?.message || `Request failed (${r.status}).`,
      data?.code,
    );
  }
  return data as T;
}

/** True when the signed-in user is a Factory admin (public.factory_admins). */
export async function checkAdmin(): Promise<boolean> {
  return (await officeRest<boolean>("rpc/factory_is_admin", { method: "POST", body: "{}" })) === true;
}

export function signedInEmail(): string | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null")?.user?.email ?? null;
  } catch {
    return null;
  }
}
