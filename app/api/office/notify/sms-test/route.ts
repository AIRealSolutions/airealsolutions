// Text the owner's saved number to check Twilio. Owner only.
import { errorResponse, HttpError } from "../../../../lib/integrations/server";
import { notifySettings, sendSms } from "../../../../lib/office/notify";
import { asUser, requireOffice } from "../../../../lib/office/server";

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, ["owner"]);
    const s = await notifySettings(asUser(user));
    if (!s.sms_to) throw new HttpError(400, "Save a phone number first.");
    return Response.json(await sendSms(s.sms_to, "The Office: text messages are working."));
  } catch (e) {
    return errorResponse(e);
  }
}
