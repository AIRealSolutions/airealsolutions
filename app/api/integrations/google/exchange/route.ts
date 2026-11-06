import { connectGoogle } from "../../../../lib/integrations/google";
import { HttpError, errorResponse, readJson, requireUser, verifyState } from "../../../../lib/integrations/server";

/** Step 2 of "Connect Google": the callback page posts Google's code here. */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const { code, state } = await readJson<{ code?: string; state?: string }>(request);
    if (!code || !state) throw new HttpError(400, "Missing Google sign-in code.");
    const { redirectUri } = verifyState(state, user.id);
    return Response.json(await connectGoogle(user, code, redirectUri));
  } catch (e) {
    return errorResponse(e);
  }
}
