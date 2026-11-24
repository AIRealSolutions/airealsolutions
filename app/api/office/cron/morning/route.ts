// Weekday morning job (Vercel Cron, see vercel.json). Builds today's plan if there isn't one yet,
// then emails the brief and today's reminders when Resend is configured.
// Vercel sends `Authorization: Bearer $CRON_SECRET`; requests without it are refused.
// The cron path cannot read Google Calendar (that needs the owner's session); the plan notes it,
// and "Re-plan" on the Today page adds the calendar.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { buildPlan } from "../../../../lib/office/planner";
import { addDays, asService, localTime, officeDate, tzOffset, weekdayName, type AgendaItem, type BigGoal } from "../../../../lib/office/server";

export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized.");
    const rest = asService();
    const date = officeDate();

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
    return Response.json({ date, built, emailed, reminders: reminders.length });
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
