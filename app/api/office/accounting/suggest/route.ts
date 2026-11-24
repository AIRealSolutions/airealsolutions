// Ask for category suggestions (rules, then the Bookkeeper Agent) for transactions waiting for review.
import { errorResponse, requireAdmin } from "../../../../lib/integrations/server";
import { suggestCategories } from "../../../../lib/office/bookkeeper";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    return Response.json(await suggestCategories(asUser(await requireAdmin(request))));
  } catch (e) {
    return errorResponse(e);
  }
}
