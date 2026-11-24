// Refresh business feeds now. POST { business_id? } as a signed-in admin: fetch sources, then rank new items.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { rankNewItems, refreshFeeds } from "../../../../lib/office/feeds";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 120;
const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await readJson<{ business_id?: string }>(request).catch(() => ({ business_id: undefined }));
    if (body.business_id && !UUID.test(body.business_id)) throw new HttpError(400, "Invalid business.");
    const rest = asUser(user);
    const fetched = await refreshFeeds(rest, body.business_id);
    const ranked = await rankNewItems(rest);
    return Response.json({ ...fetched, ...ranked });
  } catch (e) {
    return errorResponse(e);
  }
}
