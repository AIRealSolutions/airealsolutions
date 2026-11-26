// Shared by the Factory agent routes: model routing and credit pricing for one agent run.
// Server-only.
import { userRest, type FactoryUser } from "../integrations/server";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

type ResolvedModel = { api_model: string; provider: string; reasoning_effort: string | null; source: string | null };
type CatalogModel = { api_model: string; input_usd_per_mtok: number | null; output_usd_per_mtok: number | null; credit_multiplier: number | null };

/** Use the Factory's model routing (factory_resolve_model); fall back to Claude Opus 5.5. */
export async function pickModel(user: FactoryUser, projectId: string, route: { stage: string; agent: string; task: string }) {
  let model = DEFAULT_MODEL;
  let effort: Effort = "high";
  let source = "default";
  try {
    const rows = await userRest<ResolvedModel[]>(user, "rpc/factory_resolve_model", {
      method: "POST",
      body: JSON.stringify({ p_project: projectId, p_stage: route.stage, p_agent: route.agent, p_task: route.task }),
    });
    const r = rows[0];
    if (r?.provider === "anthropic" && r.api_model) {
      model = r.api_model;
      source = r.source || "catalog";
    }
    if (r?.reasoning_effort && (EFFORTS as readonly string[]).includes(r.reasoning_effort)) effort = r.reasoning_effort as Effort;
  } catch (e) {
    console.error(`[${route.agent}] model routing unavailable, using default`, e);
  }
  let prices: { input: number; output: number } | null = null;
  let multiplier = 1;
  try {
    const cat = await userRest<CatalogModel[]>(
      user,
      `factory_ai_models?api_model=eq.${encodeURIComponent(model)}&select=api_model,input_usd_per_mtok,output_usd_per_mtok,credit_multiplier&limit=1`,
    );
    const m = cat[0];
    if (m?.input_usd_per_mtok != null && m.output_usd_per_mtok != null) prices = { input: Number(m.input_usd_per_mtok), output: Number(m.output_usd_per_mtok) };
    if (m?.credit_multiplier != null && Number(m.credit_multiplier) > 0) multiplier = Number(m.credit_multiplier);
  } catch {
    /* catalog prices are optional; the agents carry list prices */
  }
  return { model, effort, prices, multiplier, source };
}

/** Credits = the agent specialty's catalog estimate x the model's credit multiplier. */
export async function creditCost(user: FactoryUser, agent: string, multiplier: number, fallbackBase: number) {
  let base = fallbackBase;
  try {
    const rows = await userRest<{ default_credit_estimate: number }[]>(
      user,
      `factory_agent_specialties?code=eq.${encodeURIComponent(agent)}&select=default_credit_estimate&limit=1`,
    );
    if (rows[0]?.default_credit_estimate > 0) base = rows[0].default_credit_estimate;
  } catch {
    /* keep default */
  }
  return Math.max(1, Math.round(base * multiplier));
}

/** Best-effort project audit event. */
export async function projectEvent(user: FactoryUser, projectId: string, eventType: string, detail: object) {
  try {
    await userRest(user, "factory_project_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ project_id: projectId, actor_id: user.id, event_type: eventType, detail }),
    });
  } catch (e) {
    console.error("[factory] audit log failed", e);
  }
}
