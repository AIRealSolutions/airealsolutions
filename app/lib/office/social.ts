// Phase 7: post straight to YouTube, Facebook Pages and Instagram, and pull results back. Server-only.
// Tokens are encrypted (INTEGRATIONS_ENCRYPTION_KEY) before they are stored and never go to the browser.
// Nothing is posted unless the owner pressed Publish or scheduled it; the runner only sends queued rows.
import { HttpError, SUPABASE_KEY, SUPABASE_URL, decryptJson, encryptJson, type FactoryUser } from "../integrations/server";
import { asService, asUser, type Rest } from "./server";

export type Provider = "youtube" | "facebook" | "instagram";
export const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const BUCKET = "office-library";

export const youtubeConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.INTEGRATIONS_ENCRYPTION_KEY);
export const metaConfigured = () => Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.INTEGRATIONS_ENCRYPTION_KEY);

/** Database and storage access, either as the signed-in owner or as the server (cron). */
export type Ctx = { rest: Rest; storageHeaders: Record<string, string> };
export const userCtx = (user: FactoryUser): Ctx => ({ rest: asUser(user), storageHeaders: { apikey: SUPABASE_KEY, Authorization: `Bearer ${user.token}` } });
export function serviceCtx(): Ctx {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const headers: Record<string, string> = { apikey: key };
  if (key.startsWith("ey")) headers.Authorization = `Bearer ${key}`;
  return { rest: asService(), storageHeaders: headers };
}

/** Short-lived links to private Library files, for YouTube, Facebook and Instagram to fetch. */
async function signedUrls(ctx: Ctx, paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    cache: "no-store",
    headers: { ...ctx.storageHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn, paths }),
  });
  const d = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(d)) throw new HttpError(502, "Could not read the media from the Library.");
  const out: Record<string, string> = {};
  for (const x of d) if (x?.signedURL && x?.path) out[x.path] = `${SUPABASE_URL}/storage/v1${x.signedURL}`;
  return out;
}

// ---- accounts ----------------------------------------------------------------------------------------

type AccountRow = { id: string; business_id: string | null; provider: Provider; external_id: string; name: string; token_ciphertext: string; status: string };
type SaveAccount = { provider: Provider; external_id: string; name: string; handle?: string | null; avatar_url?: string | null; token: unknown };

/** Insert new channels (assigned to `businessId`, or matched by name) and refresh tokens on existing ones. */
async function saveAccounts(rest: Rest, accounts: SaveAccount[], businessId: string | null) {
  if (!accounts.length) return [];
  const existing = await rest<{ id: string; provider: string; external_id: string }[]>(
    `office_social_accounts?select=id,provider,external_id&external_id=in.(${accounts.map((a) => `"${a.external_id.replace(/"/g, "")}"`).join(",")})`,
  );
  const businesses = businessId ? [] : await rest<{ id: string; name: string; slug: string }[]>("office_businesses?select=id,name,slug");
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const guess = (name: string) => businesses.find((b) => norm(name).includes(norm(b.name)) || norm(name).includes(norm(b.slug)) || norm(b.name).includes(norm(name)))?.id ?? null;
  const now = new Date().toISOString();
  const saved: { id: string; provider: string; name: string; business_id: string | null }[] = [];
  for (const a of accounts) {
    const fields = { name: a.name.slice(0, 200), handle: a.handle?.slice(0, 200) ?? null, avatar_url: a.avatar_url ?? null, token_ciphertext: encryptJson(a.token), status: "connected", last_error: null };
    const hit = existing.find((e) => e.provider === a.provider && e.external_id === a.external_id);
    if (hit) {
      const rows = await rest<typeof saved>(`office_social_accounts?id=eq.${hit.id}&select=id,provider,name,business_id`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...fields, connected_at: now }),
      });
      saved.push(...rows);
    } else {
      const rows = await rest<typeof saved>("office_social_accounts?select=id,provider,name,business_id", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ ...fields, provider: a.provider, external_id: a.external_id, business_id: businessId || guess(a.name) }),
      });
      saved.push(...rows);
    }
  }
  return saved;
}

async function markAccount(rest: Rest, id: string, error: string | null, tokenUpdate?: unknown) {
  await rest(`office_social_accounts?id=eq.${id}`, {
    method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: error ? "error" : "connected", last_error: error, ...(tokenUpdate ? { token_ciphertext: encryptJson(tokenUpdate) } : {}) }),
  }).catch(() => undefined);
}

export async function disconnectAccount(rest: Rest, id: string) {
  const row = (await rest<AccountRow[]>(`office_social_accounts?id=eq.${id}&select=id,provider,token_ciphertext&limit=1`))[0];
  if (!row) throw new HttpError(404, "That channel is not connected.");
  if (row.provider === "youtube") {
    try {
      const t = decryptJson<YtToken>(row.token_ciphertext);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh_token)}`, { method: "POST" });
    } catch { /* still remove our copy */ }
  }
  await rest(`office_social_accounts?id=eq.${id}`, { method: "DELETE" });
}

// ---- YouTube (Google OAuth, its own consent so each business can use its own channel) --------------------

const YT_SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
type YtToken = { refresh_token: string; access_token?: string; expires_at?: number };

export const youtubeRedirectUri = (request: Request) => process.env.YOUTUBE_REDIRECT_URI || `${new URL(request.url).origin}/office/studio/connect/youtube`;

export function youtubeAuthUrl(state: string, redirectUri: string) {
  if (!youtubeConfigured()) throw new HttpError(503, "YouTube is not set up on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: YT_SCOPES.join(" "),
    access_type: "offline", prompt: "select_account consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function googleToken(body: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID || "", client_secret: process.env.GOOGLE_CLIENT_SECRET || "", ...body }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(400, d.error_description || d.error || "Google rejected the request.");
  return d as { access_token: string; refresh_token?: string; expires_in: number };
}

export async function connectYoutube(rest: Rest, code: string, redirectUri: string, businessId: string | null) {
  const t = await googleToken({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new HttpError(400, "Google did not return offline access. Remove the app at myaccount.google.com/permissions and try again.");
  const d = await yt<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: { default?: { url: string } } } }[] }>(
    t.access_token, "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
  const ch = d.items?.[0];
  if (!ch) throw new HttpError(400, "That Google account has no YouTube channel. Create one at youtube.com, or pick the brand account that owns the channel.");
  const token: YtToken = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  return saveAccounts(rest, [{ provider: "youtube", external_id: ch.id, name: ch.snippet.title, handle: ch.snippet.customUrl ?? null, avatar_url: ch.snippet.thumbnails?.default?.url ?? null, token }], businessId);
}

async function yt<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store", headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(r.status === 401 || r.status === 403 ? 409 : 502, d?.error?.message || `YouTube request failed (${r.status}).`);
  return d as T;
}

async function youtubeAccess(rest: Rest, acct: AccountRow): Promise<string> {
  const t = decryptJson<YtToken>(acct.token_ciphertext);
  if (t.access_token && (t.expires_at ?? 0) > Date.now() + 120_000) return t.access_token;
  try {
    const n = await googleToken({ refresh_token: t.refresh_token, grant_type: "refresh_token" });
    await markAccount(rest, acct.id, null, { ...t, access_token: n.access_token, expires_at: Date.now() + n.expires_in * 1000 });
    return n.access_token;
  } catch {
    await markAccount(rest, acct.id, "YouTube access expired or was removed. Reconnect the channel.");
    throw new HttpError(409, "YouTube access expired or was removed. Reconnect the channel in the Studio.");
  }
}

// ---- Facebook Pages and Instagram (one Meta login) ------------------------------------------------------

const META_SCOPES = ["pages_show_list", "pages_read_engagement", "pages_manage_posts", "read_insights", "business_management", "instagram_basic", "instagram_content_publish", "instagram_manage_insights"];
type MetaToken = { page_token: string; page_id: string };

export const metaRedirectUri = (request: Request) => process.env.META_REDIRECT_URI || `${new URL(request.url).origin}/office/studio/connect/meta`;

export function metaAuthUrl(state: string, redirectUri: string) {
  if (!metaConfigured()) throw new HttpError(503, "Facebook and Instagram are not set up on the server (META_APP_ID / META_APP_SECRET).");
  const p = new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: redirectUri, state, response_type: "code", scope: META_SCOPES.join(",") });
  return `https://www.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}/dialog/oauth?${p}`;
}

async function graph<T>(path: string, params: Record<string, string> = {}, method: "GET" | "POST" = "GET"): Promise<T> {
  const url = `${GRAPH}/${path.replace(/^\//, "")}`;
  const body = new URLSearchParams(params);
  const r = method === "GET"
    ? await fetch(`${url}${url.includes("?") ? "&" : "?"}${body}`, { cache: "no-store" })
    : await fetch(url, { method: "POST", cache: "no-store", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d?.error) {
    const e = d?.error || {};
    const expired = e.code === 190 || (e.type === "OAuthException" && /session|expired|token/i.test(e.message || ""));
    throw new HttpError(expired ? 409 : 502, e.error_user_msg || e.message || `Facebook request failed (${r.status}).`);
  }
  return d as T;
}

export async function connectMeta(rest: Rest, code: string, redirectUri: string, businessId: string | null) {
  const app = { client_id: process.env.META_APP_ID || "", client_secret: process.env.META_APP_SECRET || "" };
  const short = await graph<{ access_token: string }>("oauth/access_token", { ...app, redirect_uri: redirectUri, code });
  // A long-lived user token makes Page tokens that do not expire.
  const long = await graph<{ access_token: string }>("oauth/access_token", { ...app, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token });
  type Page = { id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } };
  const pages: Page[] = [];
  let next: string | null = `me/accounts?fields=id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}&limit=100&access_token=${encodeURIComponent(long.access_token)}`;
  while (next && pages.length < 300) {
    const d: { data: Page[]; paging?: { next?: string } } = await graph(next);
    pages.push(...(d.data || []));
    next = d.paging?.next ? d.paging.next.replace(`${GRAPH}/`, "") : null;
  }
  if (!pages.length) throw new HttpError(400, "No Facebook Pages came back. When Facebook asks, choose the Pages (and their Instagram accounts) the Office may post to.");
  const accounts: SaveAccount[] = [];
  for (const p of pages) {
    accounts.push({ provider: "facebook", external_id: p.id, name: p.name, avatar_url: p.picture?.data?.url ?? null, token: { page_token: p.access_token, page_id: p.id } satisfies MetaToken });
    const ig = p.instagram_business_account;
    if (ig) accounts.push({ provider: "instagram", external_id: ig.id, name: ig.username ? `@${ig.username}` : `${p.name} (Instagram)`, handle: ig.username ?? null, avatar_url: ig.profile_picture_url ?? null, token: { page_token: p.access_token, page_id: p.id } satisfies MetaToken });
  }
  return saveAccounts(rest, accounts, businessId);
}

// ---- publishing -----------------------------------------------------------------------------------------

type Pub = {
  id: string; content_id: string; account_id: string | null; provider: Provider; account_name: string; status: string; privacy: string;
  asset_ids: string[]; container_id: string | null; attempts: number; publish_at: string;
};
type Piece = { id: string; title: string; format: string; draft: Record<string, unknown>; asset_ids: string[] };
type Media = { id: string; storage_path: string; mime: string | null; kind: string; file_name: string; size_bytes: number | null };
type Outcome = { status: "published"; external_id: string; external_url: string | null } | { status: "processing"; container_id: string };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
const hashtags = (d: Record<string, unknown>) => arr(d.hashtags).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
const captionOf = (d: Record<string, unknown>, max: number) => [str(d.caption) || str(d.hook), [str(d.cta)].filter(Boolean).join(""), hashtags(d)].filter(Boolean).join("\n\n").slice(0, max);
const vertical = (format: string) => format === "reel" || format === "short";

async function publishYoutube(ctx: Ctx, acct: AccountRow, pub: Pub, piece: Piece, media: Media[], urls: Record<string, string>): Promise<Outcome> {
  const video = media.find((m) => m.kind === "video");
  if (!video) throw new HttpError(400, "YouTube needs a video. Attach one from the Library or make one with the reel maker.");
  const token = await youtubeAccess(ctx.rest, acct);
  const d = piece.draft;
  const shorts = vertical(piece.format);
  const title = (arr(d.title_options)[0] || piece.title).replace(/[<>]/g, "").slice(0, shorts ? 90 : 100) + (shorts && !/#shorts/i.test(piece.title) ? " #Shorts" : "");
  const description = [str(d.description) || str(d.caption) || str(d.hook), arr(d.chapters).join("\n"), str(d.cta), hashtags(d)].filter(Boolean).join("\n\n").replace(/[<>]/g, "").slice(0, 4900);
  const tags = arr(d.hashtags).map((h) => h.replace(/^#/, "")).slice(0, 15);
  const file = await fetch(urls[video.storage_path], { cache: "no-store" });
  if (!file.ok) throw new HttpError(502, "Could not read the video from the Library.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": video.mime || "video/mp4", "X-Upload-Content-Length": String(bytes.byteLength) },
    body: JSON.stringify({
      snippet: { title, description, tags, categoryId: "22" },
      status: { privacyStatus: pub.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  if (!start.ok) { const e = await start.json().catch(() => ({})); throw new HttpError(start.status === 401 || start.status === 403 ? 409 : 502, e?.error?.message || "YouTube would not start the upload."); }
  const location = start.headers.get("location");
  if (!location) throw new HttpError(502, "YouTube did not return an upload address.");
  const done = await fetch(location, { method: "PUT", cache: "no-store", headers: { "Content-Type": video.mime || "video/mp4" }, body: bytes });
  const v = await done.json().catch(() => ({}));
  if (!done.ok || !v.id) throw new HttpError(502, v?.error?.message || "The YouTube upload did not finish.");
  return { status: "published", external_id: v.id, external_url: shorts ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}` };
}

async function publishFacebook(acct: AccountRow, piece: Piece, media: Media[], urls: Record<string, string>): Promise<Outcome> {
  const { page_token, page_id } = decryptJson<MetaToken>(acct.token_ciphertext);
  const auth = { access_token: page_token };
  const message = captionOf(piece.draft, 60000);
  const video = media.find((m) => m.kind === "video");
  const photos = media.filter((m) => m.kind === "image" || m.kind === "logo").slice(0, 10);
  if (video) {
    const r = await graph<{ id: string }>(`${page_id}/videos`, { ...auth, file_url: urls[video.storage_path], description: message, title: piece.title.slice(0, 250) }, "POST");
    return { status: "published", external_id: r.id, external_url: `https://www.facebook.com/${page_id}/videos/${r.id}` };
  }
  if (photos.length === 1) {
    const r = await graph<{ id: string; post_id?: string }>(`${page_id}/photos`, { ...auth, url: urls[photos[0].storage_path], message }, "POST");
    const id = r.post_id || r.id;
    return { status: "published", external_id: id, external_url: `https://www.facebook.com/${id}` };
  }
  const attached: Record<string, string> = {};
  for (const [i, p] of photos.entries()) {
    const r = await graph<{ id: string }>(`${page_id}/photos`, { ...auth, url: urls[p.storage_path], published: "false" }, "POST");
    attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: r.id });
  }
  if (!message && !photos.length) throw new HttpError(400, "Nothing to post: write a caption or attach media.");
  const r = await graph<{ id: string }>(`${page_id}/feed`, { ...auth, message, ...attached }, "POST");
  return { status: "published", external_id: r.id, external_url: `https://www.facebook.com/${r.id}` };
}

/** Instagram works in two steps: make a container, wait for it to finish processing, then publish it. */
async function publishInstagram(acct: AccountRow, pub: Pub, piece: Piece, media: Media[], urls: Record<string, string>, deadline: number): Promise<Outcome> {
  const { page_token } = decryptJson<MetaToken>(acct.token_ciphertext);
  const auth = { access_token: page_token };
  const ig = acct.external_id;
  let container = pub.container_id;
  if (!container) {
    const caption = captionOf(piece.draft, 2200);
    const video = media.find((m) => m.kind === "video");
    const photos = media.filter((m) => m.kind === "image" || m.kind === "logo").slice(0, 10);
    const notJpeg = photos.find((p) => !/jpe?g/i.test(p.mime || p.file_name));
    if (video) {
      if (!/mp4|quicktime/i.test(video.mime || video.file_name)) throw new HttpError(400, "Instagram needs an MP4 or MOV video. Make the reel in Chrome or Safari, which save MP4.");
      container = (await graph<{ id: string }>(`${ig}/media`, { ...auth, media_type: "REELS", video_url: urls[video.storage_path], caption, share_to_feed: "true" }, "POST")).id;
    } else if (photos.length) {
      if (notJpeg) throw new HttpError(400, `Instagram only accepts JPEG photos; ${notJpeg.file_name} is not one. Export it as .jpg and attach that.`);
      if (photos.length === 1) {
        container = (await graph<{ id: string }>(`${ig}/media`, { ...auth, image_url: urls[photos[0].storage_path], caption }, "POST")).id;
      } else {
        const children: string[] = [];
        for (const p of photos) children.push((await graph<{ id: string }>(`${ig}/media`, { ...auth, image_url: urls[p.storage_path], is_carousel_item: "true" }, "POST")).id);
        container = (await graph<{ id: string }>(`${ig}/media`, { ...auth, media_type: "CAROUSEL", children: children.join(","), caption }, "POST")).id;
      }
    } else {
      throw new HttpError(400, "Instagram needs a photo or a video. Attach one from the Library.");
    }
  }
  // Wait while there is time; otherwise leave it processing for the next run.
  for (;;) {
    const s = await graph<{ status_code?: string; status?: string }>(`${container}`, { ...auth, fields: "status_code,status" });
    if (s.status_code === "FINISHED" || s.status_code === "PUBLISHED") break;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new HttpError(502, `Instagram could not process the media${s.status ? `: ${s.status}` : ""}.`);
    if (Date.now() + 8_000 > deadline) return { status: "processing", container_id: container };
    await new Promise((r) => setTimeout(r, 5_000));
  }
  const m = await graph<{ id: string }>(`${ig}/media_publish`, { ...auth, creation_id: container }, "POST");
  const link = await graph<{ permalink?: string }>(m.id, { ...auth, fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return { status: "published", external_id: m.id, external_url: link.permalink ?? null };
}

export type RunResult = { published: number; processing: number; failed: number; errors: string[] };

/**
 * Send queued publications that are due (and finish Instagram ones still processing).
 * Each row is claimed with a short lock first, so the cron and an open Studio page never post twice.
 */
export async function runPublications(ctx: Ctx, opts: { contentId?: string; budgetMs?: number } = {}): Promise<RunResult> {
  const deadline = Date.now() + (opts.budgetMs ?? 200_000);
  const now = new Date().toISOString();
  const lock = new Date(Date.now() + 5 * 60_000).toISOString();
  const claimed = await ctx.rest<Pub[]>(
    `office_publications?status=in.(queued,processing)&publish_at=lte.${encodeURIComponent(now)}&or=(locked_until.is.null,locked_until.lt.${encodeURIComponent(now)})${opts.contentId ? `&content_id=eq.${opts.contentId}` : ""}&select=id,content_id,account_id,provider,account_name,status,privacy,asset_ids,container_id,attempts,publish_at`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ locked_until: lock }) },
  );
  const out: RunResult = { published: 0, processing: 0, failed: 0, errors: [] };
  for (const pub of claimed.sort((a, b) => a.publish_at.localeCompare(b.publish_at))) {
    if (Date.now() > deadline - 20_000) {
      await ctx.rest(`office_publications?id=eq.${pub.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ locked_until: null }) });
      continue;
    }
    const update: Record<string, unknown> = { locked_until: null, attempts: pub.attempts + (pub.status === "queued" ? 1 : 0) };
    try {
      if (!pub.account_id) throw new HttpError(409, `${pub.account_name} was disconnected. Reconnect it and publish again.`);
      const [acct] = await ctx.rest<AccountRow[]>(`office_social_accounts?id=eq.${pub.account_id}&select=id,business_id,provider,external_id,name,token_ciphertext,status&limit=1`);
      const [piece] = await ctx.rest<Piece[]>(`office_content?id=eq.${pub.content_id}&select=id,title,format,draft,asset_ids&limit=1`);
      if (!acct || !piece) throw new HttpError(404, "The channel or the content piece is gone.");
      const ids = pub.asset_ids.length ? pub.asset_ids : piece.asset_ids;
      const rows = ids.length ? await ctx.rest<Media[]>(`office_assets?id=in.(${ids.join(",")})&select=id,storage_path,mime,kind,file_name,size_bytes`) : [];
      const media = ids.map((id) => rows.find((r) => r.id === id)).filter((m): m is Media => Boolean(m));
      const urls = await signedUrls(ctx, media.map((m) => m.storage_path));
      const result = acct.provider === "youtube" ? await publishYoutube(ctx, acct, pub, piece, media, urls)
        : acct.provider === "facebook" ? await publishFacebook(acct, piece, media, urls)
        : await publishInstagram(acct, pub, piece, media, urls, deadline);
      if (result.status === "processing") {
        Object.assign(update, { status: "processing", container_id: result.container_id, error: null });
        out.processing++;
      } else {
        Object.assign(update, { status: "published", external_id: result.external_id, external_url: result.external_url, published_at: new Date().toISOString(), error: null });
        out.published++;
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Publishing failed.";
      console.error("[office] publish failed", pub.id, message);
      Object.assign(update, { status: "failed", error: message.slice(0, 1000) });
      if (e instanceof HttpError && e.status === 409 && pub.account_id) await markAccount(ctx.rest, pub.account_id, message);
      out.failed++;
      out.errors.push(`${pub.account_name}: ${message}`);
    }
    await ctx.rest(`office_publications?id=eq.${pub.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(update) });
  }
  return out;
}

// ---- results --------------------------------------------------------------------------------------------

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined);
const clean = (m: Record<string, number | undefined>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) as Record<string, number>;

async function metricsFor(ctx: Ctx, acct: AccountRow, externalId: string): Promise<Record<string, number>> {
  if (acct.provider === "youtube") {
    const token = await youtubeAccess(ctx.rest, acct);
    const d = await yt<{ items?: { statistics: Record<string, string> }[] }>(token, `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(externalId)}`);
    const s = d.items?.[0]?.statistics || {};
    return clean({ views: n(s.viewCount), likes: n(s.likeCount), comments: n(s.commentCount) });
  }
  const { page_token } = decryptJson<MetaToken>(acct.token_ciphertext);
  const auth = { access_token: page_token };
  if (acct.provider === "instagram") {
    const base = await graph<{ like_count?: number; comments_count?: number }>(externalId, { ...auth, fields: "like_count,comments_count" });
    const ins = await graph<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(`${externalId}/insights`, { ...auth, metric: "views,reach,shares,saved" }).catch(() => ({ data: [] }));
    const get = (k: string) => { const x = (ins.data || []).find((i) => i.name === k); return x?.total_value?.value ?? x?.values?.[0]?.value; };
    return clean({ views: get("views"), reach: get("reach"), likes: n(base.like_count), comments: n(base.comments_count), shares: get("shares"), saves: get("saved") });
  }
  const post = await graph<{ likes?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } }; shares?: { count: number } }>(
    externalId, { ...auth, fields: "likes.summary(true).limit(0),comments.summary(true).limit(0),shares" },
  ).catch(() => graph<{ likes?: { summary?: { total_count: number } }; comments?: { summary?: { total_count: number } } }>(externalId, { ...auth, fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)" }));
  const views = await graph<{ data: { values?: { value: number }[] }[] }>(`${externalId}/video_insights`, { ...auth, metric: "total_video_views" })
    .then((d) => d.data[0]?.values?.[0]?.value).catch(() => undefined);
  return clean({ views, likes: post.likes?.summary?.total_count, comments: post.comments?.summary?.total_count, shares: (post as { shares?: { count: number } }).shares?.count });
}

/** Pull views, likes, comments and shares for published posts: one piece now, or anything older than 6 hours. */
export async function refreshMetrics(ctx: Ctx, opts: { contentId?: string; limit?: number } = {}) {
  const stale = new Date(Date.now() - 6 * 3600_000).toISOString();
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const pubs = await ctx.rest<{ id: string; account_id: string | null; external_id: string | null }[]>(
    `office_publications?status=eq.published&account_id=not.is.null&external_id=not.is.null${opts.contentId ? `&content_id=eq.${opts.contentId}` : `&published_at=gte.${encodeURIComponent(since)}&or=(metrics_at.is.null,metrics_at.lt.${encodeURIComponent(stale)})`}&select=id,account_id,external_id&order=metrics_at.asc.nullsfirst&limit=${opts.limit ?? 40}`,
  );
  const ids = [...new Set(pubs.map((p) => p.account_id!))];
  const accounts = ids.length ? await ctx.rest<AccountRow[]>(`office_social_accounts?id=in.(${ids.join(",")})&select=id,business_id,provider,external_id,name,token_ciphertext,status`) : [];
  let updated = 0;
  const errors: string[] = [];
  for (const p of pubs) {
    const acct = accounts.find((a) => a.id === p.account_id);
    if (!acct) continue;
    try {
      const metrics = await metricsFor(ctx, acct, p.external_id!);
      await ctx.rest(`office_publications?id=eq.${p.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ metrics, metrics_at: new Date().toISOString() }) });
      updated++;
    } catch (e) {
      errors.push(`${acct.name}: ${e instanceof Error ? e.message : "could not read results"}`);
      await ctx.rest(`office_publications?id=eq.${p.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ metrics_at: new Date().toISOString() }) }).catch(() => undefined);
    }
  }
  return { updated, errors };
}

/** Queue a piece for the chosen channels. Re-queues rows that failed or were cancelled; leaves published ones alone. */
export async function queuePublications(rest: Rest, contentId: string, accountIds: string[], publishAt: string, privacy: string, assetIds: string[]) {
  const accounts = await rest<{ id: string; provider: Provider; name: string }[]>(`office_social_accounts?id=in.(${accountIds.join(",")})&select=id,provider,name`);
  if (accounts.length !== accountIds.length) throw new HttpError(400, "One of those channels is no longer connected.");
  const existing = await rest<{ id: string; account_id: string; status: string }[]>(`office_publications?content_id=eq.${contentId}&select=id,account_id,status`);
  for (const a of accounts) {
    const row = { status: "queued", publish_at: publishAt, privacy, asset_ids: assetIds, container_id: null, error: null, locked_until: null, provider: a.provider, account_name: a.name };
    const hit = existing.find((e) => e.account_id === a.id);
    if (hit?.status === "published" || hit?.status === "processing") continue;
    if (hit) await rest(`office_publications?id=eq.${hit.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(row) });
    else await rest("office_publications", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ ...row, content_id: contentId, account_id: a.id }) });
  }
}
