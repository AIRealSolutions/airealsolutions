// Step 1 of connecting Youtube: returns the consent URL. POST { business_id? } as an admin.
import { errorResponse, readJson, requireAdmin, signState } from "../../../../../lib/integrations/server";
import { youtubeAuthUrl, youtubeRedirectUri } from "../../../../../lib/office/social";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { business_id } = await readJson<{ business_id?: string }>(request).catch(() => ({ business_id: undefined }));
    const extra = business_id && /^[0-9a-f-]{36}$/i.test(business_id) ? business_id : "";
    const redirectUri = youtubeRedirectUri(request);
    return Response.json({ url: youtubeAuthUrl(signState({ uid: user.id, redirectUri, extra }), redirectUri) });
  } catch (e) {
    return errorResponse(e);
  }
}
