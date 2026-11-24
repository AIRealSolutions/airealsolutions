// Sunday evening job (Vercel Cron, see vercel.json): refresh feeds and draft the weekly review.
// Vercel sends `Authorization: Bearer $CRON_SECRET`; requests without it are refused.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { rankNewItems, refreshFeeds } from "../../../../lib/office/feeds";
import { buildReview, weekStartOf } from "../../../../lib/office/review";
import { asService, officeDate } from "../../../../lib/office/server";

export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new HttpError(401, "Unauthorized.");
    const rest = asService();
    const feeds = await refreshFeeds(rest).then(async (f) => ({ ...f, ...(await rankNewItems(rest)) })).catch((e) => ({ error: e instanceof Error ? e.message : "feed refresh failed" }));
    const { warning } = await buildReview(rest, weekStartOf(officeDate()), "ai");
    return Response.json({ reviewed: weekStartOf(officeDate()), warning, feeds });
  } catch (e) {
    return errorResponse(e);
  }
}
