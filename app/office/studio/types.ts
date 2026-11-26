"use client";

import { factoryToken } from "../../factory/connections/session";
import { officeToday, OFFICE_TZ, SUPABASE_KEY, SUPABASE_URL } from "../lib/client";

export type Format = "reel" | "short" | "youtube" | "post" | "carousel" | "blog" | "email" | "newsletter";
export type Status = "idea" | "drafting" | "ready" | "scheduled" | "published" | "archived";
export const FORMATS: [Format, string, string][] = [
  ["reel", "Reel", "🎬"], ["short", "Short", "📱"], ["youtube", "YouTube video", "▶️"], ["post", "Post", "📝"],
  ["carousel", "Carousel", "🖼️"], ["blog", "Blog article", "📰"], ["email", "Email", "✉️"], ["newsletter", "Newsletter", "📬"],
];
export const CHANNELS: [string, string][] = [["facebook", "Facebook"], ["instagram", "Instagram"], ["youtube", "YouTube"], ["tiktok", "TikTok"], ["linkedin", "LinkedIn"], ["x", "X"], ["website", "Website"], ["email", "Email"]];
export const STATUSES: [Status, string][] = [["idea", "Idea"], ["drafting", "Drafting"], ["ready", "Ready"], ["scheduled", "Scheduled"], ["published", "Published"], ["archived", "Archived"]];
export type Draft = {
  title_options?: string[]; hook?: string; script?: string; beats?: string[]; shot_list?: string[]; caption?: string; hashtags?: string[];
  cta?: string; description?: string; chapters?: string[]; thumbnail?: string; email_subject?: string; model?: string; written_at?: string;
};
export type Content = {
  id: string; business_id: string; title: string; format: Format; channels: string[]; status: Status; idea: string | null; draft: Draft; notes: string | null;
  asset_ids: string[]; scheduled_at: string | null; published_at: string | null; published_url: string | null; metrics: Record<string, number>; source: string; created_at: string;
};
export const CONTENT_SELECT = "id,business_id,title,format,channels,status,idea,draft,notes,asset_ids,scheduled_at,published_at,published_url,metrics,source,created_at";
export type Asset = { id: string; business_id: string | null; storage_path: string; file_name: string; mime: string | null; size_bytes: number | null; kind: string; tags: string[]; campaign: string | null; caption: string | null; created_at: string };
export const ASSET_SELECT = "id,business_id,storage_path,file_name,mime,size_bytes,kind,tags,campaign,caption,created_at";
export type BrandKit = { business_id: string; tagline: string | null; voice: string | null; audience: string | null; colors: string[]; fonts: string | null; hashtags: string[]; disclaimers: string | null; do_dont: string | null; logo_asset_id: string | null };

export const formatIcon = (f: string) => FORMATS.find(([k]) => k === f)?.[2] || "📝";
export const formatLabel = (f: string) => FORMATS.find(([k]) => k === f)?.[1] || f;
/** YYYY-MM-DD of an instant in the Office time zone. */
export const dayOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ }).format(new Date(iso));
export const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: OFFICE_TZ, hour: "numeric", minute: "2-digit" });
/** The next Monday on or after today, plus whole weeks, at 10:00 local time (as an instant). */
export function weekSlot(week: number, dayOffset = 1) {
  const t = officeToday();
  const d = new Date(`${t}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (dow === 1 ? 0 : 8 - dow) + week * 7 + dayOffset);
  return new Date(`${d.toISOString().slice(0, 10)}T10:00:00`).toISOString();
}
/** datetime-local value for an instant, in the viewer's clock. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// ---- Library storage (private bucket "office-library") ----------------------------------------
const BUCKET = "office-library";
export const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? (/logo/i.test(name) ? "logo" : "image") : mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : /pdf|word|presentation|sheet|text/.test(mime) ? "document" : "other";

export async function uploadToLibrary(file: File, prefix: string): Promise<string> {
  if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name} is over 50 MB.`);
  const token = await factoryToken();
  if (!token) throw new Error("Sign in first.");
  const safe = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-").replace(/^-+/, "").slice(-60) || "file";
  const path = `${prefix}/${crypto.randomUUID()}-${safe}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
    body: file,
  });
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d?.message || d?.error || `Upload failed (${r.status}).`); }
  return path;
}

/** Signed links for private files (default 1 hour). */
export async function libraryLinks(paths: string[], expiresIn = 3600): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const token = await factoryToken();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn, paths }),
  });
  const d = await r.json().catch(() => []);
  const out: Record<string, string> = {};
  if (Array.isArray(d)) for (const x of d) if (x?.signedURL && x?.path) out[x.path] = `${SUPABASE_URL}/storage/v1${x.signedURL}`;
  return out;
}

export async function removeFromLibrary(path: string) {
  const token = await factoryToken();
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [path] }),
  });
  if (!r.ok) throw new Error("Could not delete the file.");
}
