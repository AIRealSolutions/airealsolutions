// Read an uploaded receipt with AI. POST { path } (an object in the private "receipts" bucket). Admin only.
// Returns suggested fields for the expense form; nothing is saved here.
import { officeAiConfigured, runReceiptReader } from "../../../../lib/agents/office-agents";
import { errorResponse, HttpError, readJson, requireAdmin, SUPABASE_KEY, SUPABASE_URL } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 60;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { path } = await readJson<{ path?: string }>(request);
    if (!path || !/^[0-9a-z/_.-]{5,200}$/i.test(path) || path.includes("..")) throw new HttpError(400, "Invalid receipt path.");
    if (!officeAiConfigured()) throw new HttpError(503, "AI is not set up on the server (ANTHROPIC_API_KEY); fill the form by hand.");

    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/receipts/${path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${user.token}` },
      cache: "no-store",
    });
    if (!r.ok) throw new HttpError(404, "Receipt file not found.");
    const mediaType = (r.headers.get("content-type") || "").split(";")[0].trim();
    if (!TYPES.includes(mediaType)) throw new HttpError(415, "AI can read JPEG, PNG, WebP, GIF or PDF receipts. Fill the form by hand for this one.");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 10 * 1024 * 1024) throw new HttpError(413, "Receipt file is over 10 MB.");

    const rest = asUser(user);
    const [accounts, businesses] = await Promise.all([
      rest<{ code: string; name: string }[]>("acct_accounts?type=eq.expense&active=eq.true&select=code,name&order=code.asc"),
      rest<{ slug: string; name: string }[]>("office_businesses?select=slug,name"),
    ]);
    const { data } = await runReceiptReader({ mediaType, base64: buf.toString("base64") }, accounts, businesses);
    return Response.json({ receipt: data });
  } catch (e) {
    return errorResponse(e);
  }
}
