// Write a content piece with AI in the business's brand voice. POST { content_id } as an admin. Saves the draft.
import { officeAiConfigured, runContentWriter } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";
import { loadStudioContext } from "../../../../lib/office/studio";

export const maxDuration = 120;
const s = (v: unknown, n: number) => String(v ?? "").slice(0, n);
const list = (v: unknown, max: number, n = 500) => (Array.isArray(v) ? v.map((x) => s(x, n)).filter(Boolean).slice(0, max) : []);

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { content_id } = await readJson<{ content_id?: string }>(request);
    if (!content_id || !/^[0-9a-f-]{36}$/i.test(content_id)) throw new HttpError(400, "content_id is required.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY).");
    const rest = asUser(user);
    const piece = (await rest<{ id: string; business_id: string; title: string; format: string; channels: string[]; idea: string | null; notes: string | null; status: string; draft: Record<string, unknown> }[]>(
      `office_content?id=eq.${content_id}&select=id,business_id,title,format,channels,idea,notes,status,draft&limit=1`))[0];
    if (!piece) throw new HttpError(404, "Content not found.");
    const context = await loadStudioContext(rest, piece.business_id);
    const { data, usage } = await runContentWriter({ title: piece.title, format: piece.format, channels: piece.channels, brief: piece.idea, notes: piece.notes, current_draft: piece.draft }, context);
    const draft = {
      title_options: list(data.title_options, 5, 120), hook: s(data.hook, 1000), script: s(data.script, 20000), beats: list(data.beats, 20),
      shot_list: list(data.shot_list, 20), caption: s(data.caption, 3000), hashtags: list(data.hashtags, 15, 60).map((h) => (h.startsWith("#") ? h : `#${h}`).replace(/\s+/g, "")),
      cta: s(data.cta, 300), description: s(data.description, 5000), chapters: list(data.chapters, 20, 120), thumbnail: s(data.thumbnail, 500), email_subject: s(data.email_subject, 200),
      model: usage.model, written_at: new Date().toISOString(),
    };
    const rows = await rest<unknown[]>(`office_content?id=eq.${content_id}&select=*`, {
      method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ draft, status: piece.status === "idea" ? "drafting" : piece.status }),
    });
    return Response.json({ content: rows[0] });
  } catch (e) {
    return errorResponse(e);
  }
}
