// Weekday morning job (Vercel Cron, see vercel.json). Builds today's plan if there isn't one yet,
// then emails the brief and today's reminders when Resend is configured.
// Vercel sends `Authorization: Bearer $CRON_SECRET`; requests without it are refused.
// The cron path cannot read Google Calendar (that needs the owner's session); the plan notes it,
// and "Re-plan" on the Today page adds the calendar.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { runBillingDaily } from "../../../../lib/office/billing";
import { suggestCategories } from "../../../../lib/office/bookkeeper";
import { runCrmDaily } from "../../../../lib/office/crm";
import { plaidConfigured, syncBanks } from "../../../../lib/office/plaid";
import { rankNewItems, refreshFeeds } from "../../../../lib/office/feeds";
import { buildPlan } from "../../../../lib/office/planner";
import { addDays, asService, localTime, officeDate, tzOffset, weekdayName, type AgendaItem, type BigGoal } from "../../../../lib/office/server";

export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized.");
    const rest = asService();
    const date = officeDate();

    // Fresh news first, so the plan's brief can mention today's top items. Never blocks the plan.
    await refreshFeeds(rest).then(() => rankNewItems(rest)).catch((e) => console.error("[office] morning feed refresh failed", e));

    // Bank feeds and category suggestions, then a month-end reminder in the first days of a month.
    const banking = await (async () => {
      const synced = plaidConfigured() ? await syncBanks(rest) : null;
      const suggested = await suggestCategories(rest);
      return { synced, suggested };
    })().catch((e) => { console.error("[office] banking job failed", e); return null; });
    await closeReminder(rest, date).catch((e) => console.error("[office] close reminder failed", e));
    const crm = await runCrmDaily(rest, date).catch((e) => { console.error("[office] crm job failed", e); return null; });

    // Recurring invoices and overdue follow-ups become reminders before the plan reads them.
    const billing = await runBillingDaily(rest, date).catch((e) => { console.error("[office] billing job failed", e); return null; });

    const existing = await rest<{ brief: string; big_goals: BigGoal[]; agenda: AgendaItem[] }[]>(
      `office_daily_plans?plan_date=eq.${date}&select=brief,big_goals,agenda&limit=1`,
    );
    let plan = existing[0];
    let built = false;
    if (!plan) {
      const result = await buildPlan(rest, date, [], "Calendar not included in the early-morning plan. Use Re-plan on the Today page to fit it around your meetings.", "ai");
      plan = result.plan as typeof plan;
      built = true;
    }

    const until = `${addDays(date, 1)}T00:00:00${tzOffset(date)}`;
    const reminders = await rest<{ id: string; title: string; remind_at: string }[]>(
      `office_reminders?status=eq.pending&last_sent_at=is.null&remind_at=lt.${encodeURIComponent(until)}&select=id,title,remind_at&order=remind_at.asc&limit=30`,
    );

    const emailed = await sendBrief(date, plan, reminders);
    if (emailed && reminders.length) {
      await rest(`office_reminders?id=in.(${reminders.map((r) => r.id).join(",")})`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ last_sent_at: new Date().toISOString() }),
      });
    }
    return Response.json({ date, built, emailed, reminders: reminders.length, billing, banking, crm });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Plain-text email through Resend. Needs RESEND_API_KEY, OFFICE_BRIEF_TO and OFFICE_BRIEF_FROM. */
async function sendBrief(date: string, plan: { brief: string; big_goals: BigGoal[]; agenda: AgendaItem[] }, reminders: { title: string; remind_at: string }[]) {
  const key = process.env.RESEND_API_KEY, to = process.env.OFFICE_BRIEF_TO, from = process.env.OFFICE_BRIEF_FROM;
  if (!key || !to || !from) return false;
  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://airealsolutions.com";
  const lines = [
    plan.brief,
    "",
    "TODAY'S 3 BIG GOALS",
    ...(plan.big_goals.length ? plan.big_goals.map((g, i) => `${i + 1}. ${g.title}${g.reason ? ` — ${g.reason}` : ""}`) : ["(none yet)"]),
    "",
    "AGENDA",
    ...(plan.agenda.length ? plan.agenda.map((a) => `${a.start}–${a.end}  ${a.title}`) : ["(empty)"]),
    ...(reminders.length ? ["", "REMINDERS", ...reminders.map((r) => `${localTime(r.remind_at)}  ${r.title}`)] : []),
    "",
    `Open the Office: ${site}/office`,
  ];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `Your day — ${weekdayName(date)} ${date}`, text: lines.join("\n") }),
  });
  if (!r.ok) {
    console.error("[office] brief email failed", r.status, await r.text().catch(() => ""));
    return false;
  }
  return true;
}

/** On the 1st-5th, if last month is still open, remind once to review and close it. */
async function closeReminder(rest: ReturnType<typeof asService>, date: string) {
  if (Number(date.slice(8, 10)) > 5) return;
  const d = new Date(`${date.slice(0, 8)}01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const start = d.toISOString().slice(0, 10);
  const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const [closed, entries] = await Promise.all([
    rest<unknown[]>(`acct_periods?period_start=eq.${start}&status=eq.closed&select=id`),
    rest<unknown[]>(`acct_journal_entries?entry_date=gte.${start}&entry_date=lt.${date.slice(0, 8)}01&select=id&limit=1`),
  ]);
  if (closed.length || !entries.length) return;
  const title = `Close the books for ${label}: review bank transactions, then close the month in Accounting`;
  const exists = await rest<unknown[]>(`office_reminders?title=eq.${encodeURIComponent(title)}&select=id&limit=1`);
  if (exists.length) return;
  await rest("office_reminders", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ title, remind_at: new Date().toISOString() }) });
}
