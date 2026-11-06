import { googleConnection } from "../../../lib/integrations/google";
import { platformStatus } from "../../../lib/integrations/platform";
import { errorResponse, isAdmin, requireUser } from "../../../lib/integrations/server";

/** What is connected for the signed-in user (and, for admins, the Factory's platform accounts). */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const [row, admin] = await Promise.all([googleConnection(user), isAdmin(user)]);
    return Response.json({
      user: { email: user.email },
      isAdmin: admin,
      googleConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.INTEGRATIONS_ENCRYPTION_KEY),
      google: row ? { email: row.account_email, scopes: row.scopes, status: row.status, connectedAt: row.connected_at } : null,
      platform: admin ? await platformStatus() : null,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
