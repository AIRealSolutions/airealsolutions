// Server-only helpers for the Office. Never import from a "use client" file.
import { HttpError, SUPABASE_URL, userRest, type FactoryUser } from "../integrations/server";

export const OFFICE_TZ = "America/New_York";

/** A PostgREST caller: as the signed-in admin (RLS applies) or as the server (cron jobs). */
export type Rest = <T>(path: string, init?: RequestInit) => Promise<T>;

export const asUser = (user: FactoryUser): Rest => (path, init) => userRest(user, path, init);

/** Service-role PostgREST caller for scheduled jobs. Uses SUPABASE_SECRET_KEY (or the legacy service-role key). */
export function asService(): Rest {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpError(503, "SUPABASE_SECRET_KEY is not configured on the server.");
  return async <T>(path: string, init: RequestInit = {}) => {
    const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
    if (key.startsWith("ey")) headers.Authorization = `Bearer ${key}`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      cache: "no-store",
      headers: { ...headers, ...((init.headers as Record<string, string>) || {}) },
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new HttpError(r.status >= 500 ? 502 : 400, data?.message || "Database request failed.");
    return data as T;
  };
}

/** YYYY-MM-DD for "now" (or a given instant) in the Office time zone. */
export function officeDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

/** Offset of the Office time zone on a date, e.g. "-05:00", so a local wall time can become an instant. */
export function tzOffset(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: OFFICE_TZ, timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`));
  const name = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-05:00";
  return name === "GMT" ? "+00:00" : name.replace("GMT", "");
}

/** "HH:MM" wall time of an ISO instant in the Office time zone. */
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: OFFICE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

// ---- planning context ----------------------------------------------------------

export type PlanBusiness = { id: string; slug: string; name: string; relationship: string; status: string; weekly_focus: string | null };
export type PlanGoal = { id: string; business_id: string; level: string; title: string; target_value: number | null; current_value: number; unit: string | null; due_on: string | null };
export type PlanTask = { id: string; business_id: string | null; goal_id: string | null; title: string; due_on: string | null; estimate_min: number | null; priority: number };
export type PlanReminder = { id: string; business_id: string | null; title: string; remind_at: string };
export type PlanEvent = { summary: string; start: string; end: string; allDay: boolean };

export type PlanContext = {
  date: string;
  weekday: string;
  workday: { start: string; end: string };
  businesses: PlanBusiness[];
  goals: PlanGoal[];
  tasks: PlanTask[];
  reminders: PlanReminder[];
  events: PlanEvent[];
  calendarNote: string | null;
  yesterday: { reflection: string | null; unfinished: string[] } | null;
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function workday() {
  const start = process.env.OFFICE_WORKDAY_START || "08:00";
  const end = process.env.OFFICE_WORKDAY_END || "17:30";
  return { start: HHMM.test(start) ? start : "08:00", end: HHMM.test(end) ? end : "17:30" };
}

/** Everything the planner needs for one day. Calendar events are passed in (only the user path can read Google). */
export async function loadPlanContext(rest: Rest, date: string, events: PlanEvent[], calendarNote: string | null): Promise<PlanContext> {
  const yesterday = addDays(date, -1);
  const until = `${addDays(date, 1)}T00:00:00${tzOffset(date)}`;
  const [businesses, goals, tasks, reminders, prev] = await Promise.all([
    rest<PlanBusiness[]>("office_businesses?select=id,slug,name,relationship,status,weekly_focus&order=sort_order.asc"),
    rest<PlanGoal[]>("office_goals?status=eq.open&level=in.(week,month,quarter,day)&select=id,business_id,level,title,target_value,current_value,unit,due_on&order=due_on.asc.nullslast&limit=60"),
    rest<PlanTask[]>("office_tasks?status=eq.todo&select=id,business_id,goal_id,title,due_on,estimate_min,priority&order=priority.asc,due_on.asc.nullslast&limit=80"),
    rest<PlanReminder[]>(`office_reminders?status=eq.pending&remind_at=lt.${encodeURIComponent(until)}&select=id,business_id,title,remind_at&order=remind_at.asc&limit=30`),
    rest<{ reflection: string | null; agenda: { title: string; task_id: string }[] }[]>(
      `office_daily_plans?plan_date=eq.${yesterday}&select=reflection,agenda&limit=1`,
    ),
  ]);
  const openIds = new Set(tasks.map((t) => t.id));
  const p = prev[0];
  return {
    date,
    weekday: weekdayName(date),
    workday: workday(),
    businesses,
    goals,
    tasks,
    reminders,
    events,
    calendarNote,
    yesterday: p
      ? { reflection: p.reflection, unfinished: (p.agenda || []).filter((a) => a.task_id && openIds.has(a.task_id)).map((a) => a.title) }
      : null,
  };
}

// ---- saved plan shape -----------------------------------------------------------

export type BigGoal = { title: string; business_slug: string; reason: string; task_id: string };
export type AgendaItem = { start: string; end: string; title: string; business_slug: string; task_id: string; kind: "task" | "meeting" | "break" | "admin" };
export type DayPlan = { brief: string; big_goals: BigGoal[]; agenda: AgendaItem[] };

export async function savePlan(rest: Rest, date: string, plan: DayPlan, meta: { source: "ai" | "quick"; model: string | null; usage: object | null }) {
  const rows = await rest<unknown[]>("office_daily_plans?on_conflict=plan_date", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      plan_date: date,
      brief: plan.brief,
      big_goals: plan.big_goals,
      agenda: plan.agenda,
      source: meta.source,
      model: meta.model,
      usage: meta.usage,
      generated_at: new Date().toISOString(),
    }),
  });
  return rows[0];
}
