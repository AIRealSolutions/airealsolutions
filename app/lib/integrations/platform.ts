// Platform connections the Factory itself uses to build and ship customer projects:
// GitHub (code), Vercel (hosting) and Supabase (databases). Server-only, admin-only.
// Credentials are AI Real Solutions' own tokens kept in Vercel environment variables.
import { HttpError } from "./server";

export type PlatformStatus = {
  provider: "github" | "vercel" | "supabase";
  label: string;
  configured: boolean;
  ok: boolean;
  account: string | null;
  detail: string;
  envVar: string;
};

async function call<T>(url: string, token: string, extra: Record<string, string> = {}, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch(url, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${token}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await r.text();
  let d: any = {};
  try {
    d = text ? JSON.parse(text) : {};
  } catch {
    d = { message: text.slice(0, 200) };
  }
  if (!r.ok) {
    const msg = d?.error?.message || d?.message || (typeof d?.error === "string" ? d.error : "") || `HTTP ${r.status}`;
    // Upstream auth failures become 502 so the browser does not mistake them for an expired Factory session.
    throw new HttpError([404, 409, 422].includes(r.status) ? r.status : 502, msg);
  }
  return d as T;
}

function need(envVar: string): string {
  const v = process.env[envVar];
  if (!v) throw new HttpError(503, `${envVar} is not set in Vercel environment variables.`);
  return v;
}

/** GitHub REST call with the Factory's token. */
export const gh = <T = any>(path: string, init: { method?: string; body?: unknown } = {}) =>
  call<T>(`https://api.github.com${path}`, need("GITHUB_TOKEN"), {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "airealsolutions-factory",
  }, init);

function vercelUrl(path: string) {
  const team = process.env.VERCEL_TEAM_ID;
  return `https://api.vercel.com${path}${team ? `${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
}
/** Vercel REST call with the Factory's token (scoped to VERCEL_TEAM_ID when set). */
export const vc = <T = any>(path: string, init: { method?: string; body?: unknown } = {}) => call<T>(vercelUrl(path), need("VERCEL_TOKEN"), {}, init);
/** Supabase Management API call with the Factory's token. */
export const sb = <T = any>(path: string, init: { method?: string; body?: unknown } = {}) =>
  call<T>(`https://api.supabase.com${path}`, need("SUPABASE_ACCESS_TOKEN"), {}, init);

async function check(
  provider: PlatformStatus["provider"],
  label: string,
  envVar: string,
  probe: () => Promise<{ account: string | null; detail: string }>,
): Promise<PlatformStatus> {
  if (!process.env[envVar]) return { provider, label, envVar, configured: false, ok: false, account: null, detail: `Add ${envVar} in Vercel → Settings → Environment Variables.` };
  try {
    return { provider, label, envVar, configured: true, ok: true, ...(await probe()) };
  } catch (e) {
    return { provider, label, envVar, configured: true, ok: false, account: null, detail: e instanceof Error ? e.message : "Check failed." };
  }
}

export function platformStatus(): Promise<PlatformStatus[]> {
  return Promise.all([
    check("github", "GitHub", "GITHUB_TOKEN", async () => {
      const u = await gh("/user");
      return { account: u.login, detail: `${u.public_repos + (u.total_private_repos || 0)} repositories visible` };
    }),
    check("vercel", "Vercel", "VERCEL_TOKEN", async () => {
      const [u, p] = await Promise.all([vc("/v2/user"), vc("/v9/projects?limit=100")]);
      return { account: u.user?.username || u.user?.email || null, detail: `${p.projects?.length ?? 0} projects${process.env.VERCEL_TEAM_ID ? " (team)" : ""}` };
    }),
    check("supabase", "Supabase", "SUPABASE_ACCESS_TOKEN", async () => {
      const [orgs, projects] = await Promise.all([sb("/v1/organizations"), sb("/v1/projects")]);
      return { account: orgs?.[0]?.name || null, detail: `${projects?.length ?? 0} projects` };
    }),
  ]);
}

export type PlatformResource = { name: string; url: string | null; updated: string | null; extra?: string };

export async function listResources(provider: string): Promise<PlatformResource[]> {
  if (provider === "github") {
    if (!process.env.GITHUB_TOKEN) throw new HttpError(503, "GITHUB_TOKEN is not set.");
    const repos = await gh("/user/repos?per_page=50&sort=pushed");
    return repos.map((r: any) => ({ name: r.full_name, url: r.html_url, updated: r.pushed_at, extra: r.private ? "private" : "public" }));
  }
  if (provider === "vercel") {
    if (!process.env.VERCEL_TOKEN) throw new HttpError(503, "VERCEL_TOKEN is not set.");
    const d = await vc("/v9/projects?limit=50");
    return (d.projects || []).map((p: any) => ({
      name: p.name,
      url: p.targets?.production?.alias?.[0] ? `https://${p.targets.production.alias[0]}` : null,
      updated: p.updatedAt ? new Date(p.updatedAt).toISOString() : null,
      extra: p.framework || undefined,
    }));
  }
  if (provider === "supabase") {
    if (!process.env.SUPABASE_ACCESS_TOKEN) throw new HttpError(503, "SUPABASE_ACCESS_TOKEN is not set.");
    const d = await sb("/v1/projects");
    return (d || []).map((p: any) => ({
      name: p.name,
      url: `https://supabase.com/dashboard/project/${p.id}`,
      updated: p.created_at,
      extra: `${p.region} · ${p.status}`,
    }));
  }
  throw new HttpError(400, "Unknown provider.");
}
