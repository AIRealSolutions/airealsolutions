// Weekly Reviewer. POST { mode?: "ai" | "quick" } as a signed-in admin; reviews the current week (Mon-Sun).
import { errorResponse, readJson, requireAdmin } from "../../../lib/integrations/server";
import { buildReview, weekStartOf } from "../../../lib/office/review";
import { asUser, officeDate } from "../../../lib/office/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await readJson<{ mode?: string }>(request).catch(() => ({ mode: undefined }));
    return Response.json(await buildReview(asUser(user), weekStartOf(officeDate()), body.mode === "quick" ? "quick" : "ai"));
  } catch (e) {
    return errorResponse(e);
  }
}
