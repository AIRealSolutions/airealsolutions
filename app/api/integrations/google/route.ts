import { disconnectGoogle } from "../../../lib/integrations/google";
import { errorResponse, requireUser } from "../../../lib/integrations/server";

/** Disconnect Google: revoke access at Google and delete the stored tokens. */
export async function DELETE(request: Request) {
  try {
    await disconnectGoogle(await requireUser(request));
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
