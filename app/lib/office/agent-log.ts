// The Agents Desk's record of every AI run: which agent, model, tokens, estimated cost, time, and errors.
// Also enforces the optional monthly AI budget set on the Settings page. Server-only.
import { HttpError } from "../integrations/server";
import type { AiUsage } from "../agents/office-agents";
import type { Rest } from "./server";

/** List prices in dollars per million tokens: [input, output, cache read]. Estimates only. */
const PRICES: [RegExp, [number, number, number]][] = [
  [/fable-5-2|mythos-5-2/, [8, 40, 0.2]],
  [/fable|mythos/, [10, 50, 1]],
  [/opus-5-5/, [4, 20, 0.2]],
  [/opus/, [5, 25, 0.5]],
  [/sonnet-5-5/, [2, 10, 0.1]],
  [/sonnet-5/, [2, 10, 0.2]],
  [/sonnet/, [3, 15, 0.3]],
  [/haiku-5-5/, [0.1, 0.5, 0.01]],
  [/haiku/, [1, 5, 0.1]],
];
export function estimateCost(u: Pick<AiUsage, "model" | "input_tokens" | "output_tokens" | "cache_read_input_tokens">) {
  const [inp, out, cache] = PRICES.find(([re]) => re.test(u.model))?.[1] ?? [4, 20, 0.2];
  return (u.input_tokens * inp + u.output_tokens * out + u.cache_read_input_tokens * cache) / 1_000_000;
}

type Meta = { business_id?: string | null; subject?: string | null };

async function record(rest: Rest, row: Record<string, unknown>) {
  try {
    await rest("office_agent_runs", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
  } catch {
    /* phase 8 not run yet, or logging failed: never block the agent's work */
  }
}

/** Refuse new AI work once the month's spend reaches the owner's budget (when one is set). */
async function checkBudget(rest: Rest) {
  let budget: number | null = null, spent = 0;
  try {
    const [b, s] = await Promise.all([
      rest<number | null>("rpc/office_ai_budget", { method: "POST", body: "{}" }),
      rest<number>("rpc/office_ai_spend_this_month", { method: "POST", body: "{}" }),
    ]);
    budget = b == null ? null : Number(b);
    spent = Number(s) || 0;
  } catch {
    return; // phase 8 not run yet: no budget
  }
  if (budget != null && budget > 0 && spent >= budget) {
    throw new HttpError(402, `This month's AI budget ($${budget.toFixed(2)}) is used up. Raise it in Office Settings to keep going.`);
  }
}

/** Run an agent and log it to the Agents Desk. `fn` is a call to one of the run* functions in office-agents. */
export async function logged<T extends { usage: AiUsage }>(rest: Rest, agent: string, fn: () => Promise<T>, meta: Meta = {}): Promise<T> {
  await checkBudget(rest);
  const t0 = Date.now();
  const base = { agent, business_id: meta.business_id ?? null, subject: meta.subject ? String(meta.subject).slice(0, 200) : null };
  try {
    const r = await fn();
    const u = r.usage;
    await record(rest, {
      ...base, ok: true, model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_tokens: u.cache_read_input_tokens,
      cost_usd: Number(estimateCost(u).toFixed(4)), fell_back: u.fell_back, duration_ms: Date.now() - t0,
    });
    return r;
  } catch (e) {
    await record(rest, { ...base, ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 500), duration_ms: Date.now() - t0 });
    throw e;
  }
}
