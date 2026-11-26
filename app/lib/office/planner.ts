// Builds and saves a day's plan: Claude when available, the rule-based quick plan otherwise.
import { officeAiConfigured, runDailyPlanner } from "../agents/office-agents";
import { listEventsBetween } from "../integrations/google";
import { HttpError, type FactoryUser } from "../integrations/server";
import { quickPlan } from "./quick-plan";
import { addDays, loadPlanContext, localTime, savePlan, tzOffset, type PlanEvent, type Rest } from "./server";
import { logged } from "./agent-log";

/** Today's Google Calendar events as local "HH:MM" blocks. Never throws: returns a note instead. */
export async function todaysEvents(user: FactoryUser, date: string): Promise<{ events: PlanEvent[]; note: string | null }> {
  try {
    const off = tzOffset(date);
    const raw = await listEventsBetween(user, `${date}T00:00:00${off}`, `${addDays(date, 1)}T00:00:00${off}`);
    const events = raw.map((e) => {
      const allDay = !e.start.includes("T");
      return { summary: e.summary, start: allDay ? "00:00" : localTime(e.start), end: allDay ? "23:59" : localTime(e.end), allDay };
    });
    return { events, note: null };
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : "Google Calendar could not be read.";
    return { events: [], note: `Calendar not included: ${msg}` };
  }
}

export async function buildPlan(rest: Rest, date: string, events: PlanEvent[], calendarNote: string | null, mode: "ai" | "quick") {
  const ctx = await loadPlanContext(rest, date, events, calendarNote);
  let warning: string | null = calendarNote;
  if (mode === "ai" && officeAiConfigured()) {
    try {
      const { plan, usage } = await logged(rest, "daily-planner", () => runDailyPlanner(ctx));
      const row = await savePlan(rest, date, plan, { source: "ai", model: usage.model, usage });
      return { plan: row, source: "ai" as const, warning };
    } catch (e) {
      console.error("[office] daily planner failed, using quick plan", e);
      warning = [warning, `AI planner unavailable (${e instanceof Error ? e.message : "error"}); this is a quick plan.`].filter(Boolean).join(" ");
    }
  } else if (mode === "ai") {
    warning = [warning, "AI is not set up on the server (ANTHROPIC_API_KEY), so this is a quick plan."].filter(Boolean).join(" ");
  }
  const row = await savePlan(rest, date, quickPlan(ctx), { source: "quick", model: null, usage: null });
  return { plan: row, source: "quick" as const, warning };
}
