// Give a Factory project its own infrastructure: GitHub repo → Supabase project → Vercel project →
// link (env vars) → deploy → custom domain. Server-only, admin-only.
// Every step is idempotent: run it again and it reuses what already exists.
import { randomBytes } from "node:crypto";
import { gh, sb, vc } from "./platform";
import { type FactoryUser, HttpError, encryptJson, userRest } from "./server";

export const ACTIONS = ["github", "supabase", "vercel", "link", "deploy", "domain", "refresh"] as const;
export type Action = (typeof ACTIONS)[number];

export type Infra = {
  project_id: string;
  github_repo: string | null;
  github_repo_id: number | null;
  github_url: string | null;
  vercel_project_id: string | null;
  vercel_project_name: string | null;
  vercel_url: string | null;
  supabase_ref: string | null;
  supabase_url: string | null;
  supabase_status: string | null;
  env_linked_at: string | null;
  last_deployment_id: string | null;
  last_deployment_url: string | null;
  last_deployment_state: string | null;
  domain: string | null;
  domain_verified: boolean | null;
  domain_records: DnsRecord[];
  last_error: string | null;
  updated_at: string | null;
};
export type DnsRecord = { type: string; host: string; value: string; note?: string };
type Project = { id: string; name: string; slug: string; repository_url: string | null; deployment_url: string | null };

const COLUMNS =
  "project_id,github_repo,github_repo_id,github_url,vercel_project_id,vercel_project_name,vercel_url,supabase_ref,supabase_url,supabase_status,env_linked_at,last_deployment_id,last_deployment_url,last_deployment_state,domain,domain_verified,domain_records,last_error,updated_at";

/** Repo / Vercel-safe name: lowercase letters, digits and dashes. */
export const safeName = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 90) || "factory-project";

export async function findProject(user: FactoryUser, slug: string): Promise<Project> {
  const rows = await userRest<Project[]>(user, "rpc/factory_admin_project", { method: "POST", body: JSON.stringify({ p_slug: slug }) });
  if (!rows?.[0]) throw new HttpError(404, "Project not found.");
  return rows[0];
}

export async function getInfra(user: FactoryUser, projectId: string): Promise<Infra | null> {
  const rows = await userRest<Infra[]>(user, `factory_project_infrastructure?project_id=eq.${projectId}&select=${COLUMNS}&limit=1`);
  return rows[0] ?? null;
}

async function save(user: FactoryUser, projectId: string, patch: Partial<Infra> & { db_pass_ciphertext?: string }) {
  const rows = await userRest<Infra[]>(user, `factory_project_infrastructure?on_conflict=project_id&select=${COLUMNS}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ project_id: projectId, ...patch, updated_by: user.id, updated_at: new Date().toISOString() }),
  });
  return rows[0];
}

async function audit(user: FactoryUser, projectId: string, action: string, detail: object) {
  try {
    await userRest(user, "factory_project_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ project_id: projectId, actor_id: user.id, event_type: `infrastructure.${action}`, detail }),
    });
  } catch {
    /* admin may not be a project member; the infrastructure row still records the result */
  }
}

async function setProjectUrls(user: FactoryUser, projectId: string, repo?: string | null, live?: string | null) {
  await userRest(user, "rpc/factory_admin_set_project_urls", {
    method: "POST",
    body: JSON.stringify({ p_project: projectId, p_repository_url: repo ?? null, p_deployment_url: live ?? null }),
  }).catch(() => undefined);
}

// ---- steps -----------------------------------------------------------------

async function createRepo(user: FactoryUser, p: Project, infra: Infra | null) {
  if (infra?.github_repo) return {};
  const me = await gh<{ login: string }>("/user");
  const owner = process.env.GITHUB_OWNER || me.login;
  const name = safeName(p.slug);
  const description = `${p.name}, built by the AI Real Solutions Factory`;
  const template = process.env.GITHUB_TEMPLATE_REPO; // "owner/repo" marked as a template on GitHub
  let repo: { id: number; full_name: string; html_url: string };
  try {
    repo = template
      ? await gh(`/repos/${template}/generate`, { method: "POST", body: { owner, name, description, private: true } })
      : await gh(owner.toLowerCase() === me.login.toLowerCase() ? "/user/repos" : `/orgs/${owner}/repos`, {
          method: "POST",
          body: { name, description, private: true, auto_init: true },
        });
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 422)) throw e;
    repo = await gh(`/repos/${owner}/${name}`); // already exists: adopt it
  }
  await setProjectUrls(user, p.id, repo.html_url, null);
  return { github_repo: repo.full_name, github_repo_id: repo.id, github_url: repo.html_url };
}

async function createSupabase(p: Project, infra: Infra | null, confirmCost: boolean) {
  if (infra?.supabase_ref) return {};
  if (!confirmCost) throw new HttpError(400, "Creating a Supabase project can add a monthly charge. Confirm to continue.");
  const orgs = await sb<{ id: string; slug?: string; name: string }[]>("/v1/organizations");
  const org = process.env.SUPABASE_ORG_SLUG || orgs[0]?.slug || orgs[0]?.id;
  if (!org) throw new HttpError(400, "No Supabase organization found for SUPABASE_ACCESS_TOKEN.");
  const dbPass = randomBytes(24).toString("base64url");
  const created = await sb<{ id?: string; ref?: string; status?: string }>("/v1/projects", {
    method: "POST",
    body: { name: p.name.slice(0, 64), organization_slug: org, db_pass: dbPass, region_selection: { type: "smartGroup", code: "americas" } },
  });
  const ref = created.ref || created.id;
  if (!ref) throw new HttpError(502, "Supabase did not return a project reference.");
  return {
    supabase_ref: ref,
    supabase_url: `https://${ref}.supabase.co`,
    supabase_status: created.status || "COMING_UP",
    db_pass_ciphertext: encryptJson({ db_pass: dbPass }),
  };
}

async function createVercel(p: Project, infra: Infra | null) {
  if (infra?.vercel_project_id) return {};
  if (!infra?.github_repo) throw new HttpError(409, "Create the GitHub repository first.");
  const name = safeName(p.slug);
  let project: { id: string; name: string; link?: { repo?: string; org?: string }; targets?: { production?: { alias?: string[] } } };
  try {
    project = await vc("/v11/projects", {
      method: "POST",
      body: { name, framework: "nextjs", gitRepository: { type: "github", repo: infra.github_repo } },
    });
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 409)) {
      if (e instanceof Error && /install|github/i.test(e.message)) {
        throw new HttpError(400, `${e.message} Make sure the Vercel GitHub app can access ${infra.github_repo}.`);
      }
      throw e;
    }
    project = await vc(`/v9/projects/${name}`);
    const linked = project.link?.org && project.link?.repo ? `${project.link.org}/${project.link.repo}` : "";
    if (linked.toLowerCase() !== infra.github_repo.toLowerCase()) {
      throw new HttpError(409, `A Vercel project named "${name}" already exists and is not linked to ${infra.github_repo}.`);
    }
  }
  const alias = project.targets?.production?.alias?.[0];
  return { vercel_project_id: project.id, vercel_project_name: project.name, vercel_url: `https://${alias || `${project.name}.vercel.app`}` };
}

type ApiKey = { name: string; api_key: string; type?: string | null };

async function link(infra: Infra | null) {
  if (!infra?.supabase_ref || !infra.vercel_project_id) throw new HttpError(409, "Create the Supabase and Vercel projects first.");
  const proj = await sb<{ status: string }>(`/v1/projects/${infra.supabase_ref}`);
  if (proj.status !== "ACTIVE_HEALTHY") {
    throw Object.assign(new HttpError(409, `The database is still starting (${proj.status}). Try again in a minute or two.`), {
      patch: { supabase_status: proj.status },
    });
  }
  let keys = await sb<ApiKey[]>(`/v1/projects/${infra.supabase_ref}/api-keys?reveal=true`);
  if (!keys.some((k) => k.type === "publishable")) {
    await sb(`/v1/projects/${infra.supabase_ref}/api-keys`, { method: "POST", body: { type: "publishable", name: "default" } }).catch(() => undefined);
    await sb(`/v1/projects/${infra.supabase_ref}/api-keys?reveal=true`, {
      method: "POST",
      body: { type: "secret", name: "default", secret_jwt_template: { role: "service_role" } },
    }).catch(() => undefined);
    keys = await sb<ApiKey[]>(`/v1/projects/${infra.supabase_ref}/api-keys?reveal=true`);
  }
  const publishable = keys.find((k) => k.type === "publishable")?.api_key || keys.find((k) => k.name === "anon")?.api_key;
  const secret = keys.find((k) => k.type === "secret")?.api_key || keys.find((k) => k.name === "service_role")?.api_key;
  if (!publishable) throw new HttpError(502, "Could not read the new database's API keys.");
  const targets = ["production", "preview"];
  const env = [
    { key: "NEXT_PUBLIC_SUPABASE_URL", value: infra.supabase_url, type: "plain", target: [...targets, "development"] },
    { key: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: publishable, type: "plain", target: [...targets, "development"] },
    ...(secret ? [{ key: "SUPABASE_SECRET_KEY", value: secret, type: "sensitive", target: targets }] : []),
  ];
  await vc(`/v10/projects/${infra.vercel_project_id}/env?upsert=true`, { method: "POST", body: env });
  return { supabase_status: proj.status, env_linked_at: new Date().toISOString() };
}

async function deploy(user: FactoryUser, p: Project, infra: Infra | null) {
  if (!infra?.vercel_project_id || !infra.github_repo || !infra.github_repo_id) throw new HttpError(409, "Create the GitHub repository and Vercel project first.");
  const repo = await gh<{ default_branch: string }>(`/repos/${infra.github_repo}`);
  const d = await vc<{ id: string; url: string; readyState?: string }>("/v13/deployments", {
    method: "POST",
    body: {
      name: infra.vercel_project_name,
      project: infra.vercel_project_id,
      target: "production",
      gitSource: { type: "github", repoId: String(infra.github_repo_id), ref: repo.default_branch || "main" },
    },
  });
  await setProjectUrls(user, p.id, null, infra.domain && infra.domain_verified ? `https://${infra.domain}` : infra.vercel_url);
  return { last_deployment_id: d.id, last_deployment_url: `https://${d.url}`, last_deployment_state: d.readyState || "QUEUED" };
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

async function domainStatus(projectId: string, domain: string) {
  const [pd, cfg] = await Promise.all([
    vc<{ verified: boolean; verification?: { type: string; domain: string; value: string; reason?: string }[] }>(`/v9/projects/${projectId}/domains/${domain}`),
    vc<{ misconfigured: boolean; recommendedIPv4?: { rank: number; value: string[] }[]; recommendedCNAME?: { rank: number; value: string }[] }>(`/v6/domains/${domain}/config`),
  ]);
  const labels = domain.split(".");
  const apex = labels.length === 2;
  const records: DnsRecord[] = apex
    ? [{ type: "A", host: "@", value: cfg.recommendedIPv4?.[0]?.value?.[0] || "76.76.21.21", note: "Root domain → Vercel" }]
    : [{ type: "CNAME", host: labels.slice(0, -2).join("."), value: (cfg.recommendedCNAME?.[0]?.value || "cname.vercel-dns.com").replace(/\.$/, ""), note: "Subdomain → Vercel" }];
  for (const v of pd.verification || []) {
    records.push({ type: v.type, host: v.domain.replace(new RegExp(`\\.?${labels.slice(-2).join("\\.")}$`), "") || "@", value: v.value, note: "Ownership check" });
  }
  return { domain_records: records, domain_verified: pd.verified && !cfg.misconfigured };
}

async function addDomain(user: FactoryUser, p: Project, infra: Infra | null, raw: string) {
  if (!infra?.vercel_project_id) throw new HttpError(409, "Create the Vercel project first.");
  const domain = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!DOMAIN.test(domain)) throw new HttpError(400, "Enter a domain like example.com or app.example.com.");
  try {
    await vc(`/v10/projects/${infra.vercel_project_id}/domains`, { method: "POST", body: { name: domain } });
  } catch (e) {
    if (!(e instanceof HttpError && e.status === 409)) throw e; // already added to this project is fine
  }
  const status = await domainStatus(infra.vercel_project_id, domain);
  if (status.domain_verified) await setProjectUrls(user, p.id, null, `https://${domain}`);
  return { domain, ...status };
}

async function refresh(infra: Infra | null) {
  if (!infra) return {};
  const patch: Partial<Infra> = {};
  if (infra.supabase_ref) patch.supabase_status = (await sb<{ status: string }>(`/v1/projects/${infra.supabase_ref}`)).status;
  if (infra.last_deployment_id) {
    const d = await vc<{ readyState: string; url: string }>(`/v13/deployments/${infra.last_deployment_id}`);
    patch.last_deployment_state = d.readyState;
  }
  if (infra.domain && infra.vercel_project_id) Object.assign(patch, await domainStatus(infra.vercel_project_id, infra.domain));
  return patch;
}

/** Run one provisioning action and return the updated infrastructure record. */
export async function runAction(user: FactoryUser, slug: string, action: Action, opts: { confirmCost?: boolean; domain?: string } = {}) {
  const p = await findProject(user, slug);
  const infra = await getInfra(user, p.id);
  try {
    let patch: object;
    switch (action) {
      case "github": patch = await createRepo(user, p, infra); break;
      case "supabase": patch = await createSupabase(p, infra, Boolean(opts.confirmCost)); break;
      case "vercel": patch = await createVercel(p, infra); break;
      case "link": patch = await link(infra); break;
      case "deploy": patch = await deploy(user, p, infra); break;
      case "domain": patch = await addDomain(user, p, infra, opts.domain || ""); break;
      case "refresh": patch = await refresh(infra); break;
    }
    const saved = await save(user, p.id, { ...patch, last_error: null });
    if (action !== "refresh") await audit(user, p.id, action, { ...patch, db_pass_ciphertext: undefined });
    return saved;
  } catch (e) {
    const extra = (e as { patch?: object }).patch || {};
    await save(user, p.id, { ...extra, last_error: `${action}: ${e instanceof Error ? e.message : "failed"}` }).catch(() => undefined);
    throw e;
  }
}
