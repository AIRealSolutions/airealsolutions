// Turn a won deal into a Factory client project. POST { deal_id } as an admin.
import { errorResponse, HttpError, readJson, requireAdmin } from "../../../../lib/integrations/server";
import { asUser } from "../../../../lib/office/server";

export async function POST(request: Request) {
  try {
    const user = await requireAdmin(request);
    const { deal_id } = await readJson<{ deal_id?: string }>(request);
    if (!deal_id || !/^[0-9a-f-]{36}$/i.test(deal_id)) throw new HttpError(400, "deal_id is required.");
    const rest = asUser(user);
    const deal = (await rest<{ id: string; title: string; factory_project_id: string | null; office_companies: { name: string } | null; office_contacts: { name: string } | null }[]>(
      `office_deals?id=eq.${deal_id}&select=id,title,factory_project_id,office_companies(name),office_contacts(name)&limit=1`))[0];
    if (!deal) throw new HttpError(404, "Deal not found.");
    if (deal.factory_project_id) return Response.json({ project_id: deal.factory_project_id, existing: true });
    const org = (await rest<{ id: string }[]>("factory_organizations?select=id&order=created_at.asc&limit=1"))[0];
    if (!org) throw new HttpError(409, "No Factory organization found.");
    const name = (deal.office_companies?.name || deal.office_contacts?.name || deal.title).slice(0, 120);
    const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "client"}-${Math.random().toString(36).slice(2, 6)}`;
    const project = (await rest<{ id: string; slug: string }[]>("factory_projects?select=id,slug", {
      method: "POST", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ organization_id: org.id, name, slug, summary: deal.title, project_type: "client_build", stage: "discovery", created_by: user.id, next_action: "Run discovery and onboarding with the client" }),
    }))[0];
    await rest(`office_deals?id=eq.${deal.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ factory_project_id: project.id }) });
    return Response.json({ project_id: project.id, slug: project.slug });
  } catch (e) {
    return errorResponse(e);
  }
}
