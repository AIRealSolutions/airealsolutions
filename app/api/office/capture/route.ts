// Quick capture. POST { text } as a signed-in admin. AI files it as a task, reminder or note;
// without AI it is saved as a note so nothing is lost.
import { officeAiConfigured, runCapture } from "../../../lib/agents/office-agents";
import { HttpError, errorResponse, readJson } from "../../../lib/integrations/server";
import { asUser, officeDate, weekdayName, requireOffice, WORK } from "../../../lib/office/server";
import { logged } from "../../../lib/office/agent-log";

export const maxDuration = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const { text } = await readJson<{ text?: string }>(request);
    const capture = String(text ?? "").trim();
    if (!capture) throw new HttpError(400, "Type something to capture.");
    if (capture.length > 4000) throw new HttpError(413, "Keep a capture under 4,000 characters.");
    const rest = asUser(user);
    const businesses = await rest<{ id: string; slug: string; name: string }[]>("office_businesses?select=id,slug,name&order=sort_order.asc");
    const insert = async (table: string, row: object) =>
      (await rest<Record<string, unknown>[]>(table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) }))[0];

    if (!officeAiConfigured()) {
      const note = await insert("office_notes", { title: capture.split("\n")[0].slice(0, 80), body: capture });
      return Response.json({ kind: "note", record: note, business: null, ai: false });
    }

    const today = officeDate();
    const { data: c, usage } = await logged(rest, "quick-capture", () => runCapture(capture, today, weekdayName(today), businesses.map(({ slug, name }) => ({ slug, name }))));
    const biz = businesses.find((b) => b.slug === c.business_slug) || null;
    const title = (c.title || capture).trim().slice(0, 200);
    let record;
    if (c.kind === "reminder" && LOCAL.test(c.remind_at)) {
      // Postgres reads the zone name, so the wall time is stored as the right instant.
      record = await insert("office_reminders", { title, notes: c.body || null, business_id: biz?.id ?? null, remind_at: `${c.remind_at.replace("T", " ")} America/New_York` });
    } else if (c.kind === "task" || c.kind === "reminder") {
      record = await insert("office_tasks", {
        title,
        notes: c.body && c.body !== title ? c.body : null,
        business_id: biz?.id ?? null,
        due_on: DATE.test(c.due_on) ? c.due_on : null,
        estimate_min: c.estimate_min > 0 ? Math.min(c.estimate_min, 1440) : null,
        priority: [1, 2, 3].includes(c.priority) ? c.priority : 2,
        source: "capture",
      });
    } else {
      record = await insert("office_notes", { title, body: c.body || capture, business_id: biz?.id ?? null });
    }
    const kind = c.kind === "reminder" && !LOCAL.test(c.remind_at) ? "task" : c.kind;
    return Response.json({ kind, record, business: biz?.name ?? null, ai: true, model: usage.model });
  } catch (e) {
    return errorResponse(e);
  }
}
