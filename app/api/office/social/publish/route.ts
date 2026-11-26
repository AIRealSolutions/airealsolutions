// Publish a content piece to connected channels, now or at a set time.
// POST { content_id, account_ids[], publish_at?: ISO (omit for now), privacy?: public|unlisted|private, asset_ids?[] } as an admin.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { queuePublications, runPublications, userCtx } from "../../../../lib/office/social";

export const maxDuration = 300;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const b = await readJson<{ content_id?: string; account_ids?: unknown; publish_at?: string | null; privacy?: string; asset_ids?: unknown }>(request);
    if (!b.content_id || !UUID.test(b.content_id)) throw new HttpError(400, "content_id is required.");
    const accountIds = Array.isArray(b.account_ids) ? [...new Set(b.account_ids.map(String).filter((x) => UUID.test(x)))].slice(0, 12) : [];
    if (!accountIds.length) throw new HttpError(400, "Pick at least one channel.");
    const assetIds = Array.isArray(b.asset_ids) ? b.asset_ids.map(String).filter((x) => UUID.test(x)).slice(0, 10) : [];
    const privacy = ["public", "unlisted", "private"].includes(b.privacy || "") ? b.privacy! : "public";
    let at = new Date();
    if (b.publish_at) {
      at = new Date(b.publish_at);
      if (Number.isNaN(at.getTime())) throw new HttpError(400, "publish_at is not a date.");
      if (at.getTime() > Date.now() + 400 * 86400_000) throw new HttpError(400, "That is more than a year out.");
    }
    const ctx = userCtx(user);
    await queuePublications(ctx.rest, b.content_id, accountIds, at.toISOString(), privacy, assetIds);
    const now = at.getTime() <= Date.now() + 30_000;
    const result = now ? await runPublications(ctx, { contentId: b.content_id, budgetMs: 270_000 }) : null;
    return Response.json({ queued: accountIds.length, scheduled_for: now ? null : at.toISOString(), result });
  } catch (e) {
    return errorResponse(e);
  }
}
