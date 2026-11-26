// Send anything due and finish Instagram posts still processing. POST { content_id? } as an admin.
// The Studio calls this while it is open; the weekday morning job also runs it.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { runPublications, userCtx } from "../../../../lib/office/social";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { content_id } = await readJson<{ content_id?: string }>(request).catch(() => ({ content_id: undefined }));
    if (content_id && !/^[0-9a-f-]{36}$/i.test(content_id)) throw new HttpError(400, "Bad content_id.");
    return Response.json(await runPublications(userCtx(user), { contentId: content_id, budgetMs: 240_000 }));
  } catch (e) {
    return errorResponse(e);
  }
}
