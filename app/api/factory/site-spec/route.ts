// Site Spec route: approved Product Synthesis -> Site Spec (draft, versioned) for the instant preview.
// POST { project: "<slug>", mode?: "ai" | "template" } with the Factory session as `Authorization: Bearer <jwt>`.
// "ai" runs the Site Agent and spends the caller's Factory Credits; "template" is free and needs no AI key.
import { runSiteAgent, type SiteContext } from "../../../lib/agents/site-agent";
import { creditCost, pickModel, projectEvent } from "../../../lib/agents/runs";
import { HttpError, errorResponse, readJson, requireUser, serviceRpc, userRest, type FactoryUser } from "../../../lib/integrations/server";
import { sanitizeSiteSpec, templateSiteSpec, type SiteSpec } from "../../../lib/site-spec";

export const maxDuration = 300;

const AGENT = "software_architect";
const STAGE = "architecture";

type Project = SiteContext["project"] & { id: string; slug: string };
type SpecRow = { id: string; version: number; status: string; source: string; model: string | null; synthesis_version: number | null; created_at: string; content: SiteSpec };

export async function GET() {
  return Response.json({ configured: aiConfigured() });
}

const aiConfigured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson<{ project?: string; mode?: string }>(request);
    if (!body.project) throw new HttpError(400, "project is required.");
    const mode = body.mode === "template" ? "template" : "ai";
    if (mode === "ai" && !aiConfigured()) {
      throw new HttpError(503, "The Site Agent is not set up on this server yet (ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY).");
    }

    const projects = await userRest<Project[]>(
      user,
      `factory_projects?slug=eq.${encodeURIComponent(body.project)}&select=id,slug,name,industry,summary,project_type&limit=1`,
    );
    const project = projects[0];
    if (!project) throw new HttpError(404, "Project not available.");

    const syntheses = await userRest<{ version: number; content: Record<string, unknown> }[]>(
      user,
      `factory_product_syntheses?project_id=eq.${project.id}&status=eq.approved&select=version,content&order=version.desc&limit=1`,
    );
    const synthesis = syntheses[0];
    if (!synthesis) throw new HttpError(400, "Approve a Product Synthesis first. The Site Spec is built from the approved version.");

    const previousRows = await userRest<SpecRow[]>(
      user,
      `factory_site_specs?project_id=eq.${project.id}&select=version,content&order=version.desc&limit=1`,
    );
    const previous = previousRows[0] ? sanitizeSiteSpec(previousRows[0].content, project.name) : null;
    const version = (previousRows[0]?.version ?? 0) + 1;

    if (mode === "template") {
      const spec = templateSiteSpec(project.name, synthesis.content);
      const row = await saveSpec(user, project.id, { version, content: spec, source: "template", model: null, agent_run_id: null, synthesis_version: synthesis.version });
      await projectEvent(user, project.id, "site_spec.generated", { version, source: "template" });
      return Response.json({ spec: row, run: null });
    }

    const { model, effort, prices, multiplier, source } = await pickModel(user, project.id, { stage: STAGE, agent: AGENT, task: "site_spec" });
    const credits = await creditCost(user, AGENT, multiplier, 250);
    const runId = await userRest<string>(user, "rpc/factory_agent_run_reserve", {
      method: "POST",
      body: JSON.stringify({ p_project: project.id, p_agent: AGENT, p_stage: STAGE, p_model: model, p_credits: credits, p_summary: `Site Spec for ${project.name}` }),
    });

    const started = Date.now();
    try {
      const { id: _id, slug: _slug, ...projectInfo } = project;
      const economics = await userRest<Record<string, unknown>[]>(user, `factory_project_economics?project_id=eq.${project.id}&select=*`).catch(() => []);
      const econ = economics[0]
        ? Object.fromEntries(Object.entries(economics[0]).filter(([k]) => !["project_id", "created_at", "updated_at"].includes(k)))
        : null;
      const result = await runSiteAgent({ project: projectInfo, synthesis: synthesis.content, economics: econ, previous }, { model, effort, prices });
      const row = await saveSpec(user, project.id, { version, content: result.spec, source: "site_agent", model: result.model, agent_run_id: runId, synthesis_version: synthesis.version });

      await serviceRpc("factory_agent_run_settle", {
        p_run: runId,
        p_status: "succeeded",
        p_model: result.model,
        p_input_tokens: result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens,
        p_output_tokens: result.usage.output_tokens,
        p_cost_micros: result.costMicros,
        p_credits_charged: credits,
        p_result_summary: `Site Spec v${version} drafted`,
        p_metadata: { site_spec_id: row.id, version, effort, model_source: source, fell_back: result.fellBack, duration_ms: Date.now() - started, usage: result.usage },
      });
      await projectEvent(user, project.id, "site_spec.generated", { version, source: "site_agent", agent_run_id: runId, model: result.model, credits });
      return Response.json({ spec: row, run: { id: runId, model: result.model, credits, costUsd: result.costMicros / 1_000_000, fellBack: result.fellBack } });
    } catch (e) {
      await serviceRpc("factory_agent_run_settle", {
        p_run: runId,
        p_status: "failed",
        p_model: model,
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_cost_micros: 0,
        p_credits_charged: 0,
        p_result_summary: e instanceof Error ? e.message : "Site Agent failed",
        p_metadata: { duration_ms: Date.now() - started },
      }).catch((err) => console.error("[site-agent] settle after failure", err));
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}

async function saveSpec(
  user: FactoryUser,
  projectId: string,
  row: { version: number; content: SiteSpec; source: string; model: string | null; agent_run_id: string | null; synthesis_version: number },
) {
  const rows = await userRest<SpecRow[]>(user, "factory_site_specs?select=id,version,status,source,model,synthesis_version,created_at,content", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ project_id: projectId, status: "draft", created_by: user.id, ...row }),
  });
  if (!rows[0]) throw new HttpError(502, "The Site Spec could not be saved.");
  return rows[0];
}
