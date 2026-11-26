// Content ideas for one business. POST { business_id, count?, weeks? } as an admin. Returns ideas; nothing is saved.
import { officeAiConfigured, runContentIdeas } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";
import { loadStudioContext } from "../../../../lib/office/studio";

export const maxDuration = 120;
const FORMATS = ["reel", "short", "youtube", "post", "carousel", "blog", "email", "newsletter"];
const CHANNELS = ["facebook", "instagram", "youtube", "tiktok", "linkedin", "x", "website", "email"];

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { business_id, count, weeks } = await readJson<{ business_id?: string; count?: number; weeks?: number }>(request);
    if (!business_id || !/^[0-9a-f-]{36}$/i.test(business_id)) throw new HttpError(400, "business_id is required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const n = Math.max(3, Math.min(20, Number(count) || 8)), w = Math.max(1, Math.min(8, Number(weeks) || 4));
    const context = await loadStudioContext(asUser(user), business_id);
    const { data } = await runContentIdeas(context, n, w);
    const ideas = (data.ideas || []).slice(0, n).map((i) => ({
      title: String(i.title || "").slice(0, 200), format: FORMATS.includes(i.format) ? i.format : "post",
      channels: (i.channels || []).filter((c) => CHANNELS.includes(c)).slice(0, 3), angle: String(i.angle || "").slice(0, 1000),
      week: Math.max(0, Math.min(w - 1, Math.round(Number(i.week) || 0))), why: String(i.why || "").slice(0, 500),
    })).filter((i) => i.title);
    return Response.json({ ideas });
  } catch (e) {
    return errorResponse(e);
  }
}
