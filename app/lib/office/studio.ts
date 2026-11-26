// What the Content Studio's AI knows about one business. Server-only.
import { HttpError } from "../integrations/server";
import type { Rest } from "./server";

export async function loadStudioContext(rest: Rest, businessId: string) {
  const optional = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
  const biz = (await rest<{ id: string; name: string; slug: string; relationship: string; category: string | null; summary: string | null; website: string | null; weekly_focus: string | null }[]>(
    `office_businesses?id=eq.${businessId}&select=id,name,slug,relationship,category,summary,website,weekly_focus&limit=1`))[0];
  if (!biz) throw new HttpError(404, "Business not found.");
  const [kit, plans, news, recent] = await Promise.all([
    optional(rest<Record<string, unknown>[]>(`office_brand_kits?business_id=eq.${businessId}&select=tagline,voice,audience,colors,hashtags,disclaimers,do_dont`), []),
    optional(rest<{ status: string; content: { sections?: { key: string; title: string; body: string }[] } }[]>(`office_venture_docs?business_id=eq.${businessId}&kind=eq.marketing_plan&select=status,content&order=version.desc&limit=3`), []),
    optional(rest<{ title: string; summary: string | null; url: string | null }[]>(`office_feed_items?business_id=eq.${businessId}&kind=eq.news&score=gte.60&status=in.(new,saved)&select=title,summary,url&order=created_at.desc&limit=8`), []),
    optional(rest<{ title: string; format: string; status: string }[]>(`office_content?business_id=eq.${businessId}&select=title,format,status&order=created_at.desc&limit=30`), []),
  ]);
  const plan = plans.find((p) => p.status === "approved") || plans[0];
  const wanted = ["positioning", "audiences", "messaging", "offer", "channels", "content", "launch"];
  return {
    business: { ...biz, owned_by_ai_real_solutions: biz.relationship !== "client" },
    brand_kit: kit[0] ?? null,
    marketing_plan: plan ? { status: plan.status, sections: (plan.content.sections || []).filter((s) => wanted.includes(s.key)).map((s) => ({ title: s.title, body: s.body.slice(0, 1500) })) } : null,
    relevant_news: news.map((n) => ({ title: n.title, summary: n.summary })),
    recent_content: recent,
  };
}
