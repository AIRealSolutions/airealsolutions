// Recent Gmail messages with one contact. GET ?email=... as an admin (uses the connected Google account).
import { listGmail } from "../../../../lib/integrations/google";
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { requireOffice, WORK } from "../../../../lib/office/server";

export async function GET(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const email = (new URL(request.url).searchParams.get("email") || "").trim().toLowerCase();
    if (!/^[^@\s"()]+@[^@\s"()]+\.[^@\s"()]+$/.test(email)) throw new HttpError(400, "A valid email is required.");
    return Response.json({ messages: await listGmail(user, `from:${email} OR to:${email}`, 15) });
  } catch (e) {
    return errorResponse(e);
  }
}
