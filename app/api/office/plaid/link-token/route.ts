// Start Plaid Link: returns a short-lived link token for the browser. Admin only.
import { errorResponse, requireAdmin } from "../../../../lib/integrations/server";
import { createLinkToken, plaidConfigured } from "../../../../lib/office/plaid";

export async function GET() {
  return Response.json({ configured: plaidConfigured(), env: process.env.PLAID_ENV || "sandbox" });
}

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    return Response.json({ link_token: await createLinkToken(user.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
