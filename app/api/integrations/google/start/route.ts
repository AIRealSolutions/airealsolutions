import { googleAuthUrl, googleRedirectUri } from "../../../../lib/integrations/google";
import { errorResponse, requireUser, signState } from "../../../../lib/integrations/server";

/** Step 1 of "Connect Google": returns the Google consent URL for the signed-in user. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const redirectUri = googleRedirectUri(request);
    return Response.json({ url: googleAuthUrl(signState({ uid: user.id, redirectUri }), redirectUri) });
  } catch (e) {
    return errorResponse(e);
  }
}
