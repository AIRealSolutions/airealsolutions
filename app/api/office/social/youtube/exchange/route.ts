// Step 2 of connecting Youtube: the callback page posts the code here; channels are saved with encrypted tokens.
import { errorResponse, HttpError, readJson, requireAdmin, verifyState } from "../../../../../lib/integrations/server";
import { asUser } from "../../../../../lib/office/server";
import { connectYoutube } from "../../../../../lib/office/social";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { code, state } = await readJson<{ code?: string; state?: string }>(request);
    if (!code || !state) throw new HttpError(400, "Missing the sign-in code.");
    const { redirectUri, extra } = verifyState(state, user.id);
    const accounts = await connectYoutube(asUser(user), code, redirectUri, extra || null);
    return Response.json({ accounts });
  } catch (e) {
    return errorResponse(e);
  }
}
