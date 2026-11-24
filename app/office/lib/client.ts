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
      missing ? "Some Office tables are not in the database yet. Run docs/office-phase0.sql and docs/office-phase1.sql in Supabase." : data?.message || `Request failed (${r.status}).`,
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

// ---- Phase 1 records -------------------------------------------------------------

export type Recurrence = "none" | "daily" | "weekdays" | "weekly" | "monthly";
export const RECURRENCES: { value: Recurrence; label: string }[] = [
  { value: "none", label: "Once" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export type Task = {
  id: string; business_id: string | null; goal_id: string | null; title: string; notes: string | null;
  due_on: string | null; estimate_min: number | null; priority: 1 | 2 | 3; status: "todo" | "done" | "dropped";
  source: string; recurrence: Recurrence; completed_at: string | null;
};
export const TASK_SELECT = "id,business_id,goal_id,title,notes,due_on,estimate_min,priority,status,source,recurrence,completed_at";

export type GoalLevel = "year" | "quarter" | "month" | "week" | "day";
export const GOAL_LEVELS: GoalLevel[] = ["year", "quarter", "month", "week", "day"];
export type Goal = {
  id: string; business_id: string; parent_id: string | null; level: GoalLevel; title: string; notes: string | null;
  target_value: number | null; current_value: number; unit: string | null; due_on: string | null; status: "open" | "done" | "dropped";
};
export const GOAL_SELECT = "id,business_id,parent_id,level,title,notes,target_value,current_value,unit,due_on,status";

export type Reminder = { id: string; business_id: string | null; title: string; notes: string | null; remind_at: string; recurrence: Recurrence; status: "pending" | "done" | "dismissed" };
export const REMINDER_SELECT = "id,business_id,title,notes,remind_at,recurrence,status";

export type Note = { id: string; business_id: string | null; title: string; body: string; pinned: boolean; updated_at: string };

export type BigGoal = { title: string; business_slug: string; reason: string; task_id: string };
export type AgendaItem = { start: string; end: string; title: string; business_slug: string; task_id: string; kind: "task" | "meeting" | "break" | "admin" };
export type DailyPlan = { id: string; plan_date: string; brief: string | null; big_goals: BigGoal[]; agenda: AgendaItem[]; reflection: string | null; source: "ai" | "quick"; model: string | null; generated_at: string | null };

/** Insert one row and return it. */
export async function officeInsert<T>(table: string, row: object): Promise<T> {
  return (await officeRest<T[]>(table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }))[0];
}
export async function officePatch(table: string, filter: string, change: object): Promise<void> {
  await officeRest(`${table}?${filter}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(change) });
}
export async function officeDelete(table: string, id: string): Promise<void> {
  await officeRest(`${table}?id=eq.${id}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
}
export async function officeRpc<T>(fn: string, args: object): Promise<T> {
  return officeRest<T>(`rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
}

// ---- dates (the Office works in America/New_York) -----------------------------------

export const OFFICE_TZ = "America/New_York";
export function officeToday(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function prettyDate(date: string | null): string {
  if (!date) return "No date";
  const today = officeToday();
  if (date === today) return "Today";
  if (date === shiftDate(today, 1)) return "Tomorrow";
  if (date === shiftDate(today, -1)) return "Yesterday";
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
export function prettyDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: OFFICE_TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
/** End of today in the Office time zone, as an ISO instant (for "due by end of day" filters). */
export function endOfOfficeDay(date: string = officeToday()): string {
  const next = shiftDate(date, 1);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: OFFICE_TZ, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${next}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "-05:00";
  return new Date(`${next}T00:00:00${off || "+00:00"}`).toISOString();
}
export const minutes = (m: number | null) => (!m ? "" : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
