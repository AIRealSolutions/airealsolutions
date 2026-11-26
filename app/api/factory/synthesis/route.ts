// Spec Agent route: onboarding answers -> AI Product Synthesis (draft, versioned).
// POST { project: "<slug>" } with the Factory session as `Authorization: Bearer <jwt>`.
// Any project member may run it; it spends that member's Factory Credits.
import { runSpecAgent, type SpecContext, type SynthesisBody } from "../../../lib/agents/spec-agent";
import { creditCost, pickModel, projectEvent } from "../../../lib/agents/runs";
import { HttpError, errorResponse, readJson, requireUser, serviceRpc, userRest, type FactoryUser } from "../../../lib/integrations/server";

export const maxDuration = 300; // long syntheses can take a few minutes

const AGENT = "factory_manager";
const STAGE = "synthesis";
type Project = SpecContext["project"] & { id: string; slug: string };

/** GET: is the Spec Agent configured on this deployment? Lets the UI choose AI vs template. */
export async function GET() {
  return Response.json({ configured: configured() });
}

const configured = () =>
  Boolean(process.env.ANTHROPIC_API_KEY) && Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await readJson<{ project?: string }>(request);
    if (!body.project) throw new HttpError(400, "project is required.");
    if (!configured()) {
      throw new HttpError(503, "The Spec Agent is not set up on this server yet (ANTHROPIC_API_KEY and SUPABASE_SECRET_KEY).");
    }

    const projects = await userRest<Project[]>(
      user,
      `factory_projects?slug=eq.${encodeURIComponent(body.project)}&select=id,slug,name,industry,summary,project_type,data_classification&limit=1`,
    );
    const project = projects[0];
    if (!project) throw new HttpError(404, "Project not available.");

    const ctx = await loadContext(user, project);
    if (!Object.keys(ctx.answers).length && !ctx.buildBrief) {
      throw new HttpError(400, "This project has no saved onboarding yet. Finish onboarding at /build and save it to the Factory first.");
    }

    const { model, effort, prices, multiplier, source } = await pickModel(user, project.id, { stage: STAGE, agent: AGENT, task: "product_synthesis" });
    const credits = await creditCost(user, AGENT, multiplier, 150);

    // Reserve credits as the user (checks access and balance), then always settle as the server.
    const runId = await userRest<string>(user, "rpc/factory_agent_run_reserve", {
      method: "POST",
      body: JSON.stringify({
        p_project: project.id,
        p_agent: AGENT,
        p_stage: STAGE,
        p_model: model,
        p_credits: credits,
        p_summary: `Product synthesis for ${project.name}`,
      }),
    });

    const started = Date.now();
    try {
      const result = await runSpecAgent(ctx, { model, effort, prices });
      const version = (await latestVersion(user, project.id)) + 1;
      const content = {
        ...result.synthesis,
        version,
        generatedAt: new Date().toISOString(),
        source: "spec_agent",
        model: result.model,
        agent_run_id: runId,
      };
      const rows = await userRest<{ id: string; version: number; status: string; content: typeof content }[]>(
        user,
        "factory_product_syntheses?select=id,version,status,content",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ project_id: project.id, version, content, status: "draft", created_by: user.id }),
        },
      );

      await serviceRpc("factory_agent_run_settle", {
        p_run: runId,
        p_status: "succeeded",
        p_model: result.model,
        p_input_tokens: result.usage.input_tokens + result.usage.cache_read_input_tokens + result.usage.cache_creation_input_tokens,
        p_output_tokens: result.usage.output_tokens,
        p_cost_micros: result.costMicros,
        p_credits_charged: credits,
        p_result_summary: `Product Synthesis v${version} drafted`,
        p_metadata: { synthesis_id: rows[0]?.id, version, effort, model_source: source, fell_back: result.fellBack, duration_ms: Date.now() - started, usage: result.usage },
      });
      await projectEvent(user, project.id, "synthesis.generated", { version, agent_run_id: runId, model: result.model, credits });

      return Response.json({
        synthesis: rows[0],
        run: { id: runId, model: result.model, credits, costUsd: result.costMicros / 1_000_000, fellBack: result.fellBack },
      });
    } catch (e) {
      // Nothing usable came back: return the reserved credits.
      await serviceRpc("factory_agent_run_settle", {
        p_run: runId,
        p_status: "failed",
        p_model: model,
        p_input_tokens: 0,
        p_output_tokens: 0,
        p_cost_micros: 0,
        p_credits_charged: 0,
        p_result_summary: e instanceof Error ? e.message : "Spec Agent failed",
        p_metadata: { duration_ms: Date.now() - started },
      }).catch((err) => console.error("[spec-agent] settle after failure", err));
      throw e;
    }
  } catch (e) {
    return errorResponse(e);
  }
}

async function loadContext(user: FactoryUser, project: Project): Promise<SpecContext> {
  const pid = project.id;
  const optional = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const [answerRows, briefs, economics, projectAddons, catalog, previous] = await Promise.all([
    userRest<{ field_key: string; answer: unknown }[]>(user, `factory_intake_answers?project_id=eq.${pid}&select=field_key,answer`),
    optional(userRest<{ content: string }[]>(user, `factory_build_briefs?project_id=eq.${pid}&select=content&order=version.desc&limit=1`), []),
    optional(userRest<Record<string, unknown>[]>(user, `factory_project_economics?project_id=eq.${pid}&select=*`), []),
    optional(userRest<unknown[]>(user, `factory_project_addons?project_id=eq.${pid}&select=status,notes,addon_id`), []),
    optional(userRest<SpecContext["addonCatalog"]>(user, "factory_addons?active=eq.true&select=name,category,description&order=name"), []),
    optional(
      userRest<{ content: SynthesisBody }[]>(user, `factory_product_syntheses?project_id=eq.${pid}&select=content&order=version.desc&limit=1`),
      [],
    ),
  ]);
  const answers: Record<string, unknown> = {};
  for (const r of answerRows) if (r.answer !== null && r.answer !== "") answers[r.field_key] = r.answer;
  const econ = economics[0] ? Object.fromEntries(Object.entries(economics[0]).filter(([k]) => !["project_id", "created_at", "updated_at"].includes(k))) : null;
  const { id: _id, slug: _slug, ...projectInfo } = project;
  return {
    project: projectInfo,
    answers,
    buildBrief: briefs[0]?.content ?? null,
    economics: econ,
    projectAddons,
    addonCatalog: catalog,
    previous: previous[0]?.content ?? null,
  };
}

async function latestVersion(user: FactoryUser, projectId: string) {
  const rows = await userRest<{ version: number }[]>(
    user,
    `factory_product_syntheses?project_id=eq.${projectId}&select=version&order=version.desc&limit=1`,
  );
  return rows[0]?.version ?? 0;
}
