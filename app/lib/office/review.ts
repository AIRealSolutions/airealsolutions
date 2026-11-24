// Weekly review: what happened Monday-Sunday, and proposed focus + week goals for next week.
import { officeAiConfigured, runWeeklyReview, type WeeklyReview } from "../agents/office-agents";
import { addDays, isoWeekday, tzOffset, type Rest } from "./server";

/** Monday of the week containing `date`. */
export const weekStartOf = (date: string) => addDays(date, 1 - isoWeekday(date));

type Biz = { id: string; slug: string; name: string; relationship: string; status: string; weekly_focus: string | null };
type T = { title: string; business_id: string | null; due_on: string | null; status: string; completed_at: string | null; priority: number };
type G = { business_id: string; level: string; title: string; status: string; target_value: number | null; current_value: number; unit: string | null; due_on: string | null };

export async function buildReview(rest: Rest, weekStart: string, mode: "ai" | "quick") {
  const weekEnd = addDays(weekStart, 6);
  const from = encodeURIComponent(`${weekStart}T00:00:00${tzOffset(weekStart)}`);
  const to = encodeURIComponent(`${addDays(weekStart, 7)}T00:00:00${tzOffset(weekEnd)}`);
  const [businesses, done, open, goals, plans] = await Promise.all([
    rest<Biz[]>("office_businesses?select=id,slug,name,relationship,status,weekly_focus&order=sort_order.asc"),
    rest<T[]>(`office_tasks?status=eq.done&completed_at=gte.${from}&completed_at=lt.${to}&select=title,business_id,due_on,status,completed_at,priority&limit=200`),
    rest<T[]>(`office_tasks?status=eq.todo&select=title,business_id,due_on,status,completed_at,priority&order=due_on.asc.nullslast&limit=200`),
    rest<G[]>(`office_goals?or=(status.eq.open,updated_at.gte.${from})&select=business_id,level,title,status,target_value,current_value,unit,due_on&limit=150`),
    rest<{ plan_date: string; reflection: string | null }[]>(`office_daily_plans?plan_date=gte.${weekStart}&plan_date=lte.${weekEnd}&select=plan_date,reflection&order=plan_date.asc`),
  ]);
  const slug = (id: string | null) => businesses.find((b) => b.id === id)?.slug || "";
  const overdue = open.filter((t) => t.due_on && t.due_on <= weekEnd);

  let review: WeeklyReview | null = null;
  let source: "ai" | "quick" = "quick";
  let model: string | null = null;
  let warning: string | null = null;

  if (mode === "ai" && officeAiConfigured()) {
    try {
      const { data, usage } = await runWeeklyReview({
        week: `${weekStart} to ${weekEnd}`,
        businesses: businesses.map(({ id: _id, ...b }) => b),
        tasks_completed: done.map((t) => ({ title: t.title, business_slug: slug(t.business_id) })),
        tasks_overdue: overdue.map((t) => ({ title: t.title, business_slug: slug(t.business_id), due_on: t.due_on })),
        tasks_open_count_by_business: Object.fromEntries(businesses.map((b) => [b.slug, open.filter((t) => t.business_id === b.id).length])),
        goals: goals.map((g) => ({ ...g, business_slug: slug(g.business_id), business_id: undefined })),
        daily_reflections: plans.filter((p) => p.reflection),
      });
      const slugs = new Set(businesses.map((b) => b.slug));
      review = {
        summary: String(data.summary || "").slice(0, 2000),
        wins: (data.wins || []).map(String).slice(0, 8),
        misses: (data.misses || []).map(String).slice(0, 8),
        proposals: (data.proposals || [])
          .filter((p) => slugs.has(p.business_slug))
          .map((p) => ({ business_slug: p.business_slug, weekly_focus: String(p.weekly_focus || "").slice(0, 300), goals: (p.goals || []).map(String).filter(Boolean).slice(0, 3) })),
      };
      source = "ai";
      model = usage.model;
    } catch (e) {
      console.error("[office] weekly review AI failed", e);
      warning = `AI reviewer unavailable (${e instanceof Error ? e.message : "error"}); this is a quick review.`;
    }
  } else if (mode === "ai") {
    warning = "AI is not set up on the server (ANTHROPIC_API_KEY), so this is a quick review.";
  }

  if (!review) {
    const active = businesses.filter((b) => b.status !== "parked");
    review = {
      summary: `${done.length} task${done.length === 1 ? "" : "s"} finished this week; ${overdue.length} overdue.`,
      wins: done.slice(0, 6).map((t) => t.title),
      misses: overdue.slice(0, 6).map((t) => `${t.title} (due ${t.due_on})`),
      proposals: active
        .map((b) => ({ b, next: open.filter((t) => t.business_id === b.id).sort((x, y) => x.priority - y.priority).slice(0, 2) }))
        .filter(({ b, next }) => next.length || b.status === "focus")
        .map(({ b, next }) => ({ business_slug: b.slug, weekly_focus: b.weekly_focus || "", goals: next.map((t) => t.title) })),
    };
  }

  const rows = await rest<unknown[]>("office_weekly_reviews?on_conflict=week_start", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ week_start: weekStart, ...review, status: "draft", source, model }),
  });
  return { review: rows[0], warning };
}
