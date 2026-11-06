import { listGmail, sendGmail } from "../../../lib/integrations/google";
import { errorResponse, readJson, requireUser } from "../../../lib/integrations/server";

/** Recent inbox messages (optional Gmail search: ?q=from:someone newer_than:7d). */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const q = new URL(request.url).searchParams.get("q") || "in:inbox";
    return Response.json({ messages: await listGmail(user, q, 10) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Send a plain-text email from the user's own Gmail. Body: { to, subject, text } */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json(await sendGmail(user, await readJson(request)));
  } catch (e) {
    return errorResponse(e);
  }
}
