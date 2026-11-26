// Disconnect a channel: revokes YouTube access and deletes the stored token. Post history is kept.
// POST { account_id } as an admin.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";
import { disconnectAccount } from "../../../../lib/office/social";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { account_id } = await readJson<{ account_id?: string }>(request);
    if (!account_id || !/^[0-9a-f-]{36}$/i.test(account_id)) throw new HttpError(400, "account_id is required.");
    await disconnectAccount(asUser(user), account_id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
