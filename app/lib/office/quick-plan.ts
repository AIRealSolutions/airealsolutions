// A plan built by rules, without AI: used when ANTHROPIC_API_KEY is not set or the AI call fails.
import type { AgendaItem, BigGoal, DayPlan, PlanContext, PlanTask } from "./server";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function quickPlan(ctx: PlanContext): DayPlan {
  const slug = (id: string | null) => ctx.businesses.find((b) => b.id === id)?.slug || "";
  const status = (id: string | null) => ctx.businesses.find((b) => b.id === id)?.status || "active";
  const rank = (t: PlanTask) =>
    (t.due_on && t.due_on < ctx.date ? 0 : t.due_on === ctx.date ? 1 : 3) +
    (status(t.business_id) === "focus" ? 0 : status(t.business_id) === "parked" ? 4 : 1) +
    (t.priority - 1);
  const candidates = [...ctx.tasks].filter((t) => status(t.business_id) !== "parked" || (t.due_on && t.due_on <= ctx.date)).sort((a, b) => rank(a) - rank(b));

  const why = (t: PlanTask) =>
    t.due_on && t.due_on < ctx.date ? "Overdue." : t.due_on === ctx.date ? "Due today." : t.priority === 1 ? "High priority." : status(t.business_id) === "focus" ? "Focus business." : "Next open task.";
  const big_goals: BigGoal[] = candidates.slice(0, 3).map((t) => ({ title: t.title, business_slug: slug(t.business_id), reason: why(t), task_id: t.id }));

  // Busy blocks: timed calendar events, plus lunch.
  const busy: { s: number; e: number }[] = ctx.events.filter((e) => !e.allDay).map((e) => ({ s: toMin(e.start), e: toMin(e.end) }));
  const dayStart = toMin(ctx.workday.start), dayEnd = toMin(ctx.workday.end);
  const agenda: AgendaItem[] = ctx.events
    .filter((e) => !e.allDay)
    .map((e) => ({ start: e.start, end: e.end, title: e.summary, business_slug: "", task_id: "", kind: "meeting" as const }));
  if (dayStart <= 12 * 60 && dayEnd >= 13 * 60 && !busy.some((b) => b.s < 12 * 60 + 30 && b.e > 12 * 60)) {
    busy.push({ s: 12 * 60, e: 12 * 60 + 30 });
    agenda.push({ start: "12:00", end: "12:30", title: "Lunch", business_slug: "", task_id: "", kind: "break" });
  }
  const free = (s: number, e: number) => !busy.some((b) => b.s < e && b.e > s);

  let cursor = dayStart;
  /** Put an item in the first free slot between `from` and `to` (defaults: cursor..end of day). */
  const place = (title: string, minutes: number, extra: Partial<AgendaItem>, from = cursor, to = dayEnd, moveCursor = true) => {
    let s = from;
    while (s + minutes <= to && !free(s, s + minutes)) s += 15;
    if (s + minutes > to) return false;
    busy.push({ s, e: s + minutes });
    agenda.push({ start: fromMin(s), end: fromMin(s + minutes), title, business_slug: "", task_id: "", kind: "task", ...extra });
    if (moveCursor) cursor = s + minutes + 10; // 10-minute buffer
    return true;
  };

  let used = 0;
  const budget = Math.round((dayEnd - dayStart - busy.reduce((n, b) => n + (b.e - b.s), 0)) * 0.8);
  const placed = new Set<string>();
  const len = (t: PlanTask) => Math.min(Math.max(t.estimate_min || 45, 15), 180);

  // 1) Standing time blocks: each business's tasks go inside its own block first.
  for (const b of ctx.blocks.filter((x) => x.business_id)) {
    let from = toMin(b.start);
    for (const t of candidates.filter((c) => c.business_id === b.business_id && !placed.has(c.id))) {
      const m = len(t);
      if (used + m > budget) break;
      if (place(t.title, m, { business_slug: slug(t.business_id), task_id: t.id }, from, toMin(b.end), false)) {
        placed.add(t.id);
        used += m;
        from = Math.max(...busy.filter((x) => x.s >= from).map((x) => x.e)) + 10;
      }
    }
  }
  // Keep other work out of business blocks where possible.
  const blockBusy = ctx.blocks.filter((x) => x.business_id).map((x) => ({ s: toMin(x.start), e: toMin(x.end) }));
  busy.push(...blockBusy);

  // 2) Everything else, in rank order.
  for (const t of candidates) {
    if (placed.has(t.id)) continue;
    const m = len(t);
    if (used + m > budget) continue;
    if (place(t.title, m, { business_slug: slug(t.business_id), task_id: t.id })) { placed.add(t.id); used += m; }
  }
  // If blocks crowded the day out, release them for the admin block.
  if (!place("Email, reminders and admin", 30, { kind: "admin" })) {
    for (const b of blockBusy) busy.splice(busy.indexOf(b), 1);
    place("Email, reminders and admin", 30, { kind: "admin" }, dayStart);
  }
  agenda.sort((a, b) => a.start.localeCompare(b.start));
  const overdue = ctx.tasks.filter((t) => t.due_on && t.due_on < ctx.date).length;
  const brief = [
    `${ctx.weekday}: ${ctx.tasks.length} open task${ctx.tasks.length === 1 ? "" : "s"}${overdue ? `, ${overdue} overdue` : ""}.`,
    ctx.events.length ? `${ctx.events.length} calendar event${ctx.events.length === 1 ? "" : "s"} today.` : ctx.calendarNote || "No calendar events today.",
    ctx.reminders.length ? `${ctx.reminders.length} reminder${ctx.reminders.length === 1 ? "" : "s"} due.` : "",
    big_goals.length ? `Start with: ${big_goals[0].title}.` : "Add a few tasks to get a plan.",
  ].filter(Boolean).join(" ");
  return { brief, big_goals, agenda };
}
