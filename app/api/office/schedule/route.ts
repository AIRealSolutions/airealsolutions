// Google Calendar events for one week. GET ?start=YYYY-MM-DD (a Monday) as a signed-in admin.
import { listEventsBetween } from "../../../lib/integrations/google";
import { errorResponse, HttpError, requireAdmin } from "../../../lib/integrations/server";
import { addDays, localTime, officeDate, tzOffset } from "../../../lib/office/server";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const start = new URL(request.url).searchParams.get("start") || officeDate();
    if (!DATE.test(start)) throw new HttpError(400, "start must look like 2026-11-23.");
    const end = addDays(start, 7);
    try {
      const raw = await listEventsBetween(user, `${start}T00:00:00${tzOffset(start)}`, `${end}T00:00:00${tzOffset(end)}`, 250);
      const events = raw.map((e) => {
        const allDay = !e.start.includes("T");
        const day = allDay ? e.start.slice(0, 10) : officeDate(new Date(e.start));
        return { id: e.id, day, summary: e.summary, allDay, start: allDay ? "" : localTime(e.start), end: allDay ? "" : localTime(e.end), htmlLink: e.htmlLink, location: e.location || null };
      });
      return Response.json({ events, note: null });
    } catch (e) {
      return Response.json({ events: [], note: e instanceof HttpError ? e.message : "Google Calendar could not be read." });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
