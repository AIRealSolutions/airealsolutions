// Every-10-minutes job (Supabase pg_cron, docs/office-phase7-scheduler.sql; Bearer $CRON_SECRET):
// sends scheduled posts, pings phones for reminders that came due, alerts on failed posts,
// and refreshes results for a few recent posts.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { notifyOffice, sendDueReminders } from "../../../../lib/office/notify";
import { refreshMetrics, runPublications, serviceCtx } from "../../../../lib/office/social";

export const maxDuration = 300;

async function run(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized.");
    const ctx = serviceCtx();
    const sent = await runPublications(ctx, { budgetMs: 200_000 }).catch((e) => { console.error("[office] tick publish failed", e); return null; });
    if (sent?.failed) {
      await notifyOffice(ctx.rest, { title: "A post failed", body: sent.errors.slice(0, 2).join(" · ").slice(0, 200), url: "/office/studio", tag: "publish-failed" }, "alert").catch(() => undefined);
    }
    const reminders = await sendDueReminders(ctx.rest).catch((e) => { console.error("[office] tick reminders failed", e); return null; });
    const results = await refreshMetrics(ctx, { limit: 5 }).catch(() => ({ updated: 0 }));
    return Response.json({ sent, reminders, results: results.updated });
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = run;
export const POST = run;
