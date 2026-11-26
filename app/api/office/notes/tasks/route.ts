// Turn a notebook note into tasks. POST { note_id } as a signed-in admin.
import { runNoteToTasks } from "../../../../lib/agents/office-agents";
import { HttpError, errorResponse, readJson } from "../../../../lib/integrations/server";
import { asUser, officeDate, requireOffice, WORK } from "../../../../lib/office/server";
import { logged } from "../../../../lib/office/agent-log";

export const maxDuration = 60;

const UUID = /^[0-9a-f-]{36}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(request: Request) {
  try {
    const user = await requireOffice(request, WORK);
    const { note_id } = await readJson<{ note_id?: string }>(request);
    if (!note_id || !UUID.test(note_id)) throw new HttpError(400, "note_id is required.");
    const rest = asUser(user);
    const notes = await rest<{ id: string; title: string; body: string; business_id: string | null; office_businesses: { name: string } | null }[]>(
      `office_notes?id=eq.${note_id}&select=id,title,body,business_id,office_businesses(name)&limit=1`,
    );
    const note = notes[0];
    if (!note) throw new HttpError(404, "Note not found.");
    if (!note.body.trim() && !note.title.trim()) throw new HttpError(400, "The note is empty.");

    const { data } = await logged(rest, "note-to-tasks", () => runNoteToTasks(note, officeDate(), note.office_businesses?.name ?? null));
    const rows = (data.tasks || [])
      .filter((t) => t.title?.trim())
      .slice(0, 12)
      .map((t) => ({
        title: t.title.trim().slice(0, 200),
        business_id: note.business_id,
        due_on: DATE.test(t.due_on) ? t.due_on : null,
        estimate_min: t.estimate_min > 0 ? Math.min(t.estimate_min, 1440) : null,
        priority: [1, 2, 3].includes(t.priority) ? t.priority : 2,
        source: "note",
        notes: `From note: ${note.title || "untitled"}`,
      }));
    if (!rows.length) return Response.json({ created: 0, tasks: [] });
    const tasks = await rest<unknown[]>("office_tasks", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rows) });
    return Response.json({ created: tasks.length, tasks });
  } catch (e) {
    return errorResponse(e);
  }
}
