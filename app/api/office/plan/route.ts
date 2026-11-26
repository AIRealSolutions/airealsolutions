// Daily Planner. POST { mode?: "ai" | "quick" } as a signed-in admin; builds and saves today's plan.
import { officeAiConfigured } from "../../../lib/agents/office-agents";
import { errorResponse, readJson } from "../../../lib/integrations/server";
import { buildPlan, todaysEvents } from "../../../lib/office/planner";
import { asUser, officeDate, requireOffice, WORK } from "../../../lib/office/server";

export const maxDuration = 120;

export async function GET() {
  return Response.json({ aiConfigured: officeAiConfigured() });
}

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const body = await readJson<{ mode?: string }>(request).catch(() => ({ mode: undefined }));
    const date = officeDate();
    const { events, note } = await todaysEvents(user, date);
    const result = await buildPlan(asUser(user), date, events, note, body.mode === "quick" ? "quick" : "ai");
    return Response.json({ ...result, events });
  } catch (e) {
    return errorResponse(e);
  }
}
