// Investor-link alert: emails the person who created a preview link when it is opened.
// POST { grant: "<uuid>" }, sent by the preview page right after factory_preview_open hands out a pass.
// No sign-in: the pass itself is the proof, and factory_preview_alert_claim (service role only) decides
// whether an email is due (first open, then at most once per 12 hours per link), so replays send nothing.
// Needs RESEND_API_KEY, SUPABASE_SECRET_KEY and a sender: FACTORY_ALERT_FROM (or OFFICE_BRIEF_FROM).
import { errorResponse, oneLine, readJson, serviceRpc } from "../../../lib/integrations/server";

type Claim = {
  to: string;
  label: string;
  project_name: string;
  project_slug: string;
  first: boolean;
  view_count: number;
  first_viewed_at: string | null;
  has_pin: boolean;
} | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    const { grant } = await readJson<{ grant?: string }>(request);
    if (!grant || !UUID.test(grant)) return Response.json({ sent: false }, { status: 400 });

    const key = process.env.RESEND_API_KEY;
    const from = process.env.FACTORY_ALERT_FROM || process.env.OFFICE_BRIEF_FROM;
    if (!key || !from || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
      return Response.json({ sent: false, reason: "not_configured" });
    }

    const claim = await serviceRpc<Claim>("factory_preview_alert_claim", { p_grant: grant });
    if (!claim?.to) return Response.json({ sent: false });

    const site = process.env.NEXT_PUBLIC_SITE_URL || "https://airealsolutions.com";
    const who = oneLine(claim.label, 120);
    const project = oneLine(claim.project_name, 120);
    const subject = claim.first ? `${who} opened the ${project} prototype` : `${who} is back on the ${project} prototype`;
    const when = new Date().toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" });
    const text = [
      claim.first
        ? `${who} just opened the private ${project} prototype link you sent (${when} ET).`
        : `${who} opened the ${project} prototype again (${when} ET). Pages viewed so far on this link: ${claim.view_count}.`,
      claim.has_pin ? "They entered the PIN." : "",
      "",
      `See which pages they viewed, or turn the link off: ${site}/factory/projects/${encodeURIComponent(claim.project_slug)}#site-preview`,
      "",
      "You get this email the first time a link is opened, then at most once every 12 hours. Switch it off for this link in the Factory (Investor links → Alerts).",
    ]
      .filter((l, i, all) => l !== "" || all[i - 1] !== "")
      .join("\n");

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [claim.to], subject, text }),
    });
    if (!r.ok) {
      console.error("[preview-alert] resend failed", r.status, await r.text().catch(() => ""));
      return Response.json({ sent: false }, { status: 502 });
    }
    return Response.json({ sent: true });
  } catch (e) {
    return errorResponse(e);
  }
}
