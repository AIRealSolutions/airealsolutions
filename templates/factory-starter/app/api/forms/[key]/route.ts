// Form posts from the site. Checks every value against the form's fields in site.json, saves through
// the rate-limited site_submit RPC, then emails the owner (the starter's one built-in automation).
import { createHash } from "node:crypto";
import { entityOf, findForm, site } from "@/lib/site";
import type { SiteField } from "@/lib/site-spec";
import { sendEmail } from "@/lib/email";
import { supabaseServer } from "@/lib/supabase/server";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function check(f: SiteField, raw: unknown): string | { error: string } {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return f.required ? { error: `${f.label} is required.` } : "";
  if (v.length > (f.type === "textarea" ? 2000 : 500)) return { error: `${f.label} is too long.` };
  if (f.type === "email" && !EMAIL.test(v)) return { error: `${f.label} must be an email address.` };
  if ((f.type === "number" || f.type === "money") && !Number.isFinite(Number(v))) return { error: `${f.label} must be a number.` };
  if (f.type === "date" && Number.isNaN(Date.parse(v))) return { error: `${f.label} must be a date.` };
  if (f.type === "select" && !f.options.includes(v)) return { error: `Choose a ${f.label.toLowerCase()} from the list.` };
  return v;
}

export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const form = findForm(key);
  const entity = form && entityOf(form.entity);
  if (!form || !entity) return Response.json({ error: "Unknown form." }, { status: 404 });

  let body: { values?: Record<string, unknown>; website?: string; elapsed?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "The form could not be read." }, { status: 400 });
  }
  // Bots: a filled hidden field or an instant submit gets a quiet "thanks" and nothing is saved.
  if (body.website || (typeof body.elapsed === "number" && body.elapsed < 1500)) return Response.json({ ok: true });

  const data: Record<string, string> = {};
  for (const k of form.fields) {
    const field = entity.fields.find((f) => f.key === k);
    if (!field) continue;
    const r = check(field, body.values?.[k]);
    if (typeof r !== "string") return Response.json({ error: r.error }, { status: 400 });
    if (r) data[k] = r;
  }
  if (!Object.keys(data).length) return Response.json({ error: "Fill in the form before sending it." }, { status: 400 });

  const sb = await supabaseServer();
  if (!sb) return Response.json({ error: "This site is not connected to its database yet." }, { status: 503 });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  const fingerprint = createHash("sha256").update(`${ip}|${request.headers.get("user-agent") || ""}|${day}`).digest("hex").slice(0, 32);
  const { error } = await sb.rpc("site_submit", { p_form: form.key, p_entity: entity.key, p_data: data, p_fingerprint: fingerprint });
  if (error) {
    const busy = error.code === "P0429";
    if (!busy) console.error("[forms] save failed", error);
    return Response.json({ error: busy ? error.message : "It could not be saved. Try again." }, { status: busy ? 429 : 502 });
  }

  // Automation: new submission -> email the owner (no approval needed: it only informs the owner).
  const owner = process.env.OWNER_EMAIL;
  if (owner) {
    const lines = entity.fields.filter((f) => data[f.key]).map((f) => `${f.label}: ${data[f.key]}`);
    const site_url = process.env.NEXT_PUBLIC_SITE_URL || "";
    const replyTo = entity.fields.find((f) => f.type === "email" && data[f.key]);
    await sendEmail(
      owner,
      `New ${form.title || entity.label} on ${site.brand.name}`,
      [...lines, "", site_url ? `See all: ${site_url}/dashboard` : ""].join("\n").trim(),
      replyTo ? data[replyTo.key] : undefined,
    ).catch((e) => console.error("[forms] owner email failed", e));
  }
  return Response.json({ ok: true });
}
