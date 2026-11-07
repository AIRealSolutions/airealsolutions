import { ACTIONS, type Action, findProject, getInfra, runAction } from "../../../lib/integrations/provision";
import { HttpError, errorResponse, readJson, requireAdmin } from "../../../lib/integrations/server";

const configured = () => ({
  github: Boolean(process.env.GITHUB_TOKEN),
  vercel: Boolean(process.env.VERCEL_TOKEN),
  supabase: Boolean(process.env.SUPABASE_ACCESS_TOKEN),
  encryption: Boolean(process.env.INTEGRATIONS_ENCRYPTION_KEY),
  template: process.env.GITHUB_TEMPLATE_REPO || null,
});

/** Admin: current dedicated-infrastructure record for a project. ?project=<slug> */
export async function GET(request: Request) {
  try {
    const user = await requireAdmin(request);
    const slug = new URL(request.url).searchParams.get("project") || "";
    const p = await findProject(user, slug);
    return Response.json({ project: { name: p.name, slug: p.slug }, infra: await getInfra(user, p.id), configured: configured() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Admin: run one step. Body: { project, action, confirmCost?, domain? } */
export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const body = await readJson<{ project?: string; action?: string; confirmCost?: boolean; domain?: string }>(request);
    if (!body.project) throw new HttpError(400, "project is required.");
    if (!ACTIONS.includes(body.action as Action)) throw new HttpError(400, `action must be one of: ${ACTIONS.join(", ")}.`);
    const infra = await runAction(user, body.project, body.action as Action, { confirmCost: body.confirmCost, domain: body.domain });
    return Response.json({ infra, configured: configured() });
  } catch (e) {
    return errorResponse(e);
  }
}
