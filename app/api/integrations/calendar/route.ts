import { createEvent, listEvents } from "../../../lib/integrations/google";
import { errorResponse, readJson, requireUser } from "../../../lib/integrations/server";

/** Upcoming events on the user's primary Google Calendar. */
export async function GET(request: Request) {
  try {
    return Response.json({ events: await listEvents(await requireUser(request), 10) });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Create an event. Body: { summary, start, end, timeZone?, description?, location?, attendees?: string[] } */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return Response.json({ event: await createEvent(user, await readJson(request)) });
  } catch (e) {
    return errorResponse(e);
  }
}
