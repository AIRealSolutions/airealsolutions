import { listResources } from "../../../lib/integrations/platform";
import { HttpError, errorResponse, requireAdmin } from "../../../lib/integrations/server";

/** Admin only: list GitHub repos, Vercel projects or Supabase projects. ?provider=github|vercel|supabase */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const provider = new URL(request.url).searchParams.get("provider") || "";
    if (!["github", "vercel", "supabase"].includes(provider)) throw new HttpError(400, "provider must be github, vercel or supabase.");
    return Response.json({ items: await listResources(provider) });
  } catch (e) {
    return errorResponse(e);
  }
}
