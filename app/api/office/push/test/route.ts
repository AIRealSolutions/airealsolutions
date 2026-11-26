// Send a test notification to the caller's own devices.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { pushConfigured, sendPush } from "../../../../lib/office/notify";
import { asUser, requireOffice } from "../../../../lib/office/server";

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, ["owner", "assistant", "cpa"]);
    if (!pushConfigured()) throw new HttpError(503, "Phone notifications are not set up (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).");
    // Row-level security limits the caller to their own subscriptions.
    const r = await sendPush(asUser(user), { title: "The Office", body: "Notifications are working on this device.", url: "/office/settings", tag: "test" }, ["owner", "assistant", "cpa"]);
    if (!r.sent) throw new HttpError(409, "No device is subscribed yet. Turn on notifications on this device first.");
    return Response.json(r);
  } catch (e) {
    return errorResponse(e);
  }
}
