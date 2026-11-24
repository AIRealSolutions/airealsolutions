// Finish Plaid Link: exchange the public token, store the connection encrypted, map accounts, first sync.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { suggestCategories } from "../../../../lib/office/bookkeeper";
import { connectBank, syncBanks } from "../../../../lib/office/plaid";
import { asUser } from "../../../../lib/office/server";

export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { public_token, institution_name } = await readJson<{ public_token?: string; institution_name?: string }>(request);
    if (!public_token || !/^public-[a-z]+-[0-9a-f-]+$/i.test(public_token)) throw new HttpError(400, "Missing or invalid public token.");
    const rest = asUser(user);
    const entity = (await rest<{ id: string }[]>("acct_entities?select=id&limit=1"))[0];
    if (!entity) throw new HttpError(409, "No company set up yet.");
    const connected = await connectBank(rest, entity.id, public_token, String(institution_name || "Bank"));
    const synced = await syncBanks(rest).catch((e) => ({ error: e instanceof Error ? e.message : "First sync failed; try Sync now." }));
    await suggestCategories(rest).catch(() => undefined);
    return Response.json({ ...connected, synced });
  } catch (e) {
    return errorResponse(e);
  }
}
