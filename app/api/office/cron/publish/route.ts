// Sends scheduled posts when they come due. Called every 10 minutes by Supabase pg_cron
// (docs/office-phase7-scheduler.sql) or any scheduler that sends `Authorization: Bearer $CRON_SECRET`.
// Also refreshes results for a few recent posts each run.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { refreshMetrics, runPublications, serviceCtx } from "../../../../lib/office/social";

export const maxDuration = 300;

async function run(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized.");
    const ctx = serviceCtx();
    const sent = await runPublications(ctx, { budgetMs: 240_000 });
    const results = await refreshMetrics(ctx, { limit: 5 }).catch(() => ({ updated: 0, errors: [] }));
    return Response.json({ sent, results: results.updated });
  } catch (e) {
    return errorResponse(e);
  }
}
export const GET = run;
export const POST = run;
