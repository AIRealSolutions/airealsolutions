// Sync bank feeds now, then suggest categories for new transactions. Admin only.
import { errorResponse, requireAdmin } from "../../../../lib/integrations/server";
import { suggestCategories } from "../../../../lib/office/bookkeeper";
import { plaidConfigured, syncBanks } from "../../../../lib/office/plaid";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const rest = asUser(await requireAdmin(request));
    const synced = plaidConfigured() ? await syncBanks(rest) : { connections: 0, added: 0, updated: 0, removed: 0, errors: [] as string[] };
    const suggested = await suggestCategories(rest);
    return Response.json({ ...synced, ...suggested });
  } catch (e) {
    return errorResponse(e);
  }
}
