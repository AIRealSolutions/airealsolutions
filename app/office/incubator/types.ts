export type Stage = "idea" | "building" | "ready" | "for_sale" | "licensed" | "sold" | "paused";
export const STAGES: [Stage, string][] = [["idea", "Idea"], ["building", "Building"], ["ready", "Ready to license"], ["for_sale", "For sale"], ["licensed", "Licensed"], ["sold", "Sold"], ["paused", "Paused"]];
export const SALE_MODELS: [string, string, string][] = [
  ["saas", "SaaS subscription", "Customers pay monthly or yearly to use it, hosted by you."],
  ["white_label", "White-label license", "A partner sells it under their own brand; you host and maintain."],
  ["source_license", "Source-code license", "A licensee gets the code to run themselves, for a fee."],
  ["exclusive_license", "Exclusive license", "One licensee gets sole rights in a market or territory."],
  ["acquisition", "Outright sale", "Sell the product, code and brand."],
];
export type Venture = { business_id: string; stage: Stage; sale_models: string[]; asking_price_cents: number | null; license_summary: string | null; goal_id: string | null; notes: string | null };
export type Item = { id: string; business_id: string; category: string; title: string; detail: string | null; template_key: string | null; status: "todo" | "doing" | "done" | "na"; task_id: string | null; source: string; sort_order: number };
export type Doc = { id: string; business_id: string; kind: "business_plan" | "marketing_plan" | "license_offer"; version: number; content: { sections: { key: string; title: string; body: string }[]; gaps?: { category: string; title: string; detail: string }[] }; status: "draft" | "approved"; source: string; model: string | null; approved_at: string | null; created_at: string };
export const CATEGORIES: [string, string][] = [["product", "Product"], ["legal", "Legal"], ["business", "Business"], ["marketing", "Marketing"], ["operations", "Operations"], ["financial", "Financial"]];
export const readiness = (items: Item[]) => {
  const applies = items.filter((i) => i.status !== "na");
  const done = applies.filter((i) => i.status === "done").length;
  return { done, total: applies.length, pct: applies.length ? Math.round((done / applies.length) * 100) : 0 };
};
