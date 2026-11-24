import type { DocKind } from "../../lib/office/venture-docs";

export type Stage = "idea" | "building" | "ready" | "live" | "for_sale" | "licensed" | "sold" | "paused";
export type Track = "production" | "sale";
const ALL_STAGES: [Stage, string][] = [["idea", "Idea"], ["building", "Building"], ["ready", "Ready to launch"], ["live", "Live"], ["for_sale", "For sale"], ["licensed", "Licensed"], ["sold", "Sold"], ["paused", "Paused"]];
export const stagesFor = (relationship: string): [Stage, string][] =>
  relationship === "client" ? ALL_STAGES.filter(([k]) => ["idea", "building", "ready", "live", "paused"].includes(k)) : ALL_STAGES;
export const STAGES = ALL_STAGES;
export const SALE_MODELS: [string, string, string][] = [
  ["saas", "SaaS subscription", "Customers pay monthly or yearly to use it, hosted by you."],
  ["white_label", "White-label license", "A partner sells it under their own brand; you host and maintain."],
  ["source_license", "Source-code license", "A licensee gets the code to run themselves, for a fee."],
  ["exclusive_license", "Exclusive license", "One licensee gets sole rights in a market or territory."],
  ["acquisition", "Outright sale", "Sell the product, code and brand."],
];
export type Venture = { business_id: string; stage: Stage; sale_models: string[]; asking_price_cents: number | null; license_summary: string | null; goal_id: string | null; production_goal_id: string | null; notes: string | null };
export type Item = { id: string; business_id: string; track: Track; category: string; title: string; detail: string | null; template_key: string | null; status: "todo" | "doing" | "done" | "na"; task_id: string | null; source: string; sort_order: number };
export type Gap = { track: Track; category: string; title: string; detail: string };
export type Doc = { id: string; business_id: string; kind: DocKind; version: number; content: { sections: { key: string; title: string; body: string }[]; gaps?: Gap[] }; status: "draft" | "approved"; source: string; model: string | null; approved_at: string | null; created_at: string };
export type Review = { id: string; doc_id: string; created_at: string; model: string | null; review: { score: number; verdict: string; strengths: string[]; weaknesses: string[]; sections: { key: string; score: number; critique: string; suggestion: string }[]; missing: string[]; questions: string[]; readiness: Gap[] } };
export type Chat = { id: string; role: "user" | "assistant"; content: string; actions: (Gap & { type: "task" | "checklist" })[]; created_at: string };
export const CATEGORIES: [string, string][] = [["product", "Product"], ["legal", "Legal"], ["business", "Business"], ["marketing", "Marketing"], ["operations", "Operations"], ["financial", "Financial"]];
export const TRACK_LABEL: Record<Track, string> = { production: "Ready for production", sale: "Ready to sell" };
export const VENTURE_SELECT = "business_id,stage,sale_models,asking_price_cents,license_summary,goal_id,production_goal_id,notes";
export const ITEM_SELECT = "id,business_id,track,category,title,detail,template_key,status,task_id,source,sort_order";
export const readiness = (items: Item[], track?: Track) => {
  const applies = items.filter((i) => (!track || i.track === track) && i.status !== "na");
  const done = applies.filter((i) => i.status === "done").length;
  return { done, total: applies.length, pct: applies.length ? Math.round((done / applies.length) * 100) : 0 };
};
