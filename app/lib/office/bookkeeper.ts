// Suggestions for bank transactions waiting for review: saved rules first, then the Bookkeeper Agent.
// Suggestions are never posted on their own; the owner accepts them on the Banking screen.
import { officeAiConfigured, runBookkeeper } from "../agents/office-agents";
import type { Rest } from "./server";

type Txn = { id: string; entity_id: string; posted_on: string; amount_cents: number; description: string; merchant: string | null; plaid_category: string | null };

export async function suggestCategories(rest: Rest) {
  const txns = await rest<Txn[]>("acct_bank_txns?status=eq.new&pending=eq.false&suggested_account_id=is.null&select=id,entity_id,posted_on,amount_cents,description,merchant,plaid_category&order=posted_on.desc&limit=120");
  if (!txns.length) return { byRule: 0, byAi: 0, ai: false };
  const [rules, accounts, businesses] = await Promise.all([
    rest<{ entity_id: string; match_text: string; account_id: string; business_id: string | null }[]>("acct_rules?select=entity_id,match_text,account_id,business_id"),
    rest<{ id: string; entity_id: string; code: string; name: string; type: string; active: boolean }[]>("acct_accounts?active=eq.true&select=id,entity_id,code,name,type,active&order=code.asc"),
    rest<{ id: string; slug: string; name: string }[]>("office_businesses?select=id,slug,name"),
  ]);
  const patch = (id: string, change: object) =>
    rest(`acct_bank_txns?id=eq.${id}&status=eq.new`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(change) });

  let byRule = 0;
  const left: Txn[] = [];
  for (const t of txns) {
    const text = `${t.merchant || ""} ${t.description}`.toLowerCase();
    const rule = rules
      .filter((r) => r.entity_id === t.entity_id && text.includes(r.match_text.toLowerCase()))
      .sort((a, b) => b.match_text.length - a.match_text.length)[0];
    if (rule) {
      await patch(t.id, { suggested_account_id: rule.account_id, suggested_business_id: rule.business_id, suggestion_source: "rule", suggestion_note: `Rule: “${rule.match_text}”` });
      byRule++;
    } else left.push(t);
  }

  let byAi = 0;
  if (left.length && officeAiConfigured()) {
    const entity = left[0].entity_id;
    const chart = accounts.filter((a) => a.entity_id === entity && a.code !== "1100" && a.code !== "2000");
    const batch = left.filter((t) => t.entity_id === entity).slice(0, 80);
    try {
      const { data } = await runBookkeeper(
        chart.map((a) => ({ code: a.code, name: a.name, type: a.type })),
        businesses.map((b) => ({ slug: b.slug, name: b.name })),
        batch.map((t, i) => ({ i, date: t.posted_on, amount_cents: t.amount_cents, description: t.description, merchant: t.merchant || "", bank_category: t.plaid_category || "" })),
      );
      for (const s of data.items || []) {
        const t = batch[s.i];
        const acc = chart.find((a) => a.code === s.account_code);
        if (!t || !acc) continue;
        await patch(t.id, {
          suggested_account_id: acc.id,
          suggested_business_id: businesses.find((b) => b.slug === s.business_slug)?.id ?? null,
          suggestion_source: "ai",
          suggestion_note: (s.note || "").slice(0, 300) || null,
        });
        byAi++;
      }
    } catch (e) {
      console.error("[office] bookkeeper agent failed", e);
    }
  }
  return { byRule, byAi, ai: officeAiConfigured() };
}
