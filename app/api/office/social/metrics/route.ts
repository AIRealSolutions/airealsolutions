// Pull views, likes, comments and shares back from the channels. POST { content_id? } as an admin.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { refreshMetrics, userCtx } from "../../../../lib/office/social";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { content_id } = await readJson<{ content_id?: string }>(request).catch(() => ({ content_id: undefined }));
    if (content_id && !/^[0-9a-f-]{36}$/i.test(content_id)) throw new HttpError(400, "Bad content_id.");
    return Response.json(await refreshMetrics(userCtx(user), { contentId: content_id }));
  } catch (e) {
    return errorResponse(e);
  }
}
