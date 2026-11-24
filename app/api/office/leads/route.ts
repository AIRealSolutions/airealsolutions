// Website lead intake (public). Accepts JSON or a plain HTML form post from:
//  - this site (same origin), or origins listed in OFFICE_LEAD_ORIGINS (comma-separated, e.g. https://cemeterybuilder.ai), or
//  - a server holding OFFICE_LEAD_KEY (header x-office-lead-key).
// Fields: name, email, phone, company, message, business (a business slug), source; "website" is a honeypot.
import { siteUrl } from "../../../lib/office/billing";
import { intakeLead } from "../../../lib/office/crm";
import { asService } from "../../../lib/office/server";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clip = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

function allowedOrigins() {
  const list = [siteUrl(), ...(process.env.OFFICE_LEAD_ORIGINS || "").split(",")].map((o) => o.trim().replace(/\/+$/, "")).filter(Boolean);
  return new Set(list.map((o) => { try { return new URL(o).origin; } catch { return ""; } }).filter(Boolean));
}
const cors = (origin: string | null) => (origin && allowedOrigins().has(origin)
  ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
  : {}) as Record<string, string>;

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: cors(request.headers.get("origin")) });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const sameSite = origin ? allowedOrigins().has(origin) || origin === new URL(request.url).origin : false;
  const keyed = Boolean(process.env.OFFICE_LEAD_KEY) && request.headers.get("x-office-lead-key") === process.env.OFFICE_LEAD_KEY;
  const headers = cors(origin);
  if (!sameSite && !keyed) return Response.json({ error: "Not allowed." }, { status: 403, headers });

  const isForm = (request.headers.get("content-type") || "").includes("form");
  let data: Record<string, unknown>;
  try {
    data = isForm ? Object.fromEntries((await request.formData()).entries()) : await request.json();
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400, headers });
  }

  const back = (ok: boolean, error?: string) => {
    if (isForm) {
      const ref = request.headers.get("referer");
      const to = ref && allowedOrigins().has(new URL(ref).origin) ? new URL(ref) : new URL(`${siteUrl()}/contact`);
      to.searchParams.set(ok ? "sent" : "error", ok ? "1" : error || "1");
      return Response.redirect(to.toString(), 303);
    }
    return Response.json(ok ? { ok: true } : { error }, { status: ok ? 200 : 400, headers });
  };

  // Bots fill the hidden "website" field, or submit faster than a person can type.
  const started = Number(data.started_at || 0);
  if (clip(data.website, 200) || (started && Date.now() - started < 2500)) return back(true);

  const lead = {
    name: clip(data.name, 120), email: clip(data.email, 200).toLowerCase(), phone: clip(data.phone, 40) || undefined,
    company: clip(data.company, 160) || undefined, message: clip(data.message, 4000) || undefined,
    business: clip(data.business, 60) || undefined, source: clip(data.source, 60) || (origin ? new URL(origin).hostname : "website"),
  };
  if (!lead.name || !EMAIL.test(lead.email)) return back(false, "Please enter your name and a valid email.");

  try {
    await intakeLead(asService(), lead);
    return back(true);
  } catch (e) {
    console.error("[leads] intake failed", e);
    return back(false, "Something went wrong. Please email us instead.");
  }
}
