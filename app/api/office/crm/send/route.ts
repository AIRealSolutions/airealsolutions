// Send an email to a contact from the connected Gmail and log it on the timeline.
// POST { contact_id, deal_id?, subject, body } as an admin.
import { sendGmail } from "../../../../lib/integrations/google";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";

const UUID = /^[0-9a-f-]{36}$/i;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { contact_id, deal_id, subject, body } = await readJson<{ contact_id?: string; deal_id?: string; subject?: string; body?: string }>(request);
    if (!contact_id || !UUID.test(contact_id) || (deal_id && !UUID.test(deal_id))) throw new HttpError(400, "contact_id is required.");
    if (!subject?.trim() || !body?.trim()) throw new HttpError(400, "Subject and message are required.");
    const rest = asUser(user);
    const c = (await rest<{ email: string | null; company_id: string | null }[]>(`office_contacts?id=eq.${contact_id}&select=email,company_id&limit=1`))[0];
    if (!c?.email) throw new HttpError(400, "This contact has no email address.");
    await sendGmail(user, { to: c.email, subject: subject.trim(), text: body });
    await rest("office_activities", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ contact_id, company_id: c.company_id, deal_id: deal_id || null, kind: "email", direction: "out", subject: subject.trim().slice(0, 300), body: body.slice(0, 20000) }),
    });
    return Response.json({ sent: true });
  } catch (e) {
    return errorResponse(e);
  }
}
