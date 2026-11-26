// Save this device's push subscription for the signed-in Office member. POST { endpoint, keys: { p256dh, auth }, device? }.
import { errorResponse, HttpError, readJson } from "../../../../lib/integrations/server";
import { asUser, requireOffice } from "../../../../lib/office/server";

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, ["owner", "assistant", "cpa"]);
    const b = await readJson<{ endpoint?: string; keys?: { p256dh?: string; auth?: string }; device?: string }>(request);
    const endpoint = String(b.endpoint || "");
    const p256dh = String(b.keys?.p256dh || ""), auth = String(b.keys?.auth || "");
    if (!/^https:\/\/[^\s]{10,2000}$/.test(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,30}$/.test(auth)) {
      throw new HttpError(400, "That push subscription doesn't look right.");
    }
    await asUser(user)("office_push_subscriptions?on_conflict=endpoint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: user.id, role: user.role, endpoint, p256dh, auth, device: String(b.device || "").slice(0, 120) || null, failures: 0 }),
    });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
