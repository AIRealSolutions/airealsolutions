// Business feeds: fetch RSS/Atom and Google News searches, store new items, then rank them.
// Server-only. Feed content is untrusted: it is stored as text and passed to the AI only as data.
import { createHash } from "node:crypto";
import { officeAiConfigured, runFeedAgent } from "../agents/office-agents";
import type { Rest } from "./server";

export type FeedSource = { id: string; business_id: string; kind: "rss" | "google_news"; name: string; config: { url?: string; query?: string }; active: boolean };
type ParsedItem = { title: string; url: string | null; summary: string; published: string | null; source: string | null };

const MAX_BYTES = 2_000_000;
const MAX_ITEMS_PER_SOURCE = 20;
const MAX_AGE_DAYS = 14;

export const googleNewsUrl = (query: string) =>
  `https://news.google.com/rss/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;

/** Only public http(s) addresses: no localhost, private ranges or internal names. */
export function publicUrl(raw: string): URL | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.username || u.password) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(".") && !h.includes(":")) return null;
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/.test(h)) return null;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return null;
  }
  if (h.includes(":") && (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("::ffff:"))) return null;
  return u;
}

/** GET with a timeout, a size cap and redirects re-checked against publicUrl. */
async function fetchText(raw: string): Promise<string> {
  let url = publicUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const r = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "AIRealSolutions-Office/1.0 (+feed reader)", Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" },
      cache: "no-store",
    });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      url = loc ? publicUrl(new URL(loc, url).toString()) : null;
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const len = Number(r.headers.get("content-length") || 0);
    if (len > MAX_BYTES) throw new Error("Feed is too large.");
    const text = await r.text();
    return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
  }
  throw new Error("Address is not a public web address, or redirects too many times.");
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function clean(s: string | undefined, max = 500): string {
  if (!s) return "";
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]*>/g, " ")   // markup that was entity-encoded
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
const tag = (block: string, name: string) => block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1];

/** Minimal RSS 2.0 / Atom parser: title, link, date, summary, source. */
export function parseFeed(xml: string): ParsedItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 50).map((b) => {
    const atomLink = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1] || b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    const link = clean(tag(b, "link"), 2000) || atomLink || clean(tag(b, "guid"), 2000);
    const date = clean(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"), 100);
    const parsed = date ? new Date(date) : null;
    return {
      title: clean(tag(b, "title"), 300),
      url: link && /^https?:\/\//i.test(link) ? link : null,
      summary: clean(tag(b, "description") || tag(b, "summary") || tag(b, "content"), 600),
      published: parsed && !isNaN(parsed.getTime()) ? parsed.toISOString() : null,
      source: clean(tag(b, "source"), 120) || null,
    };
  }).filter((i) => i.title);
}

/** Fetch every active source and store new items. Returns counts and per-source errors. */
export async function refreshFeeds(rest: Rest, onlyBusiness?: string) {
  const sources = await rest<FeedSource[]>(
    `office_feed_sources?active=eq.true${onlyBusiness ? `&business_id=eq.${onlyBusiness}` : ""}&select=id,business_id,kind,name,config,active&limit=40`,
  );
  const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
  let added = 0;
  const errors: { source: string; error: string }[] = [];

  await Promise.all(sources.map(async (s) => {
    const target = s.kind === "google_news" ? (s.config.query ? googleNewsUrl(s.config.query) : "") : s.config.url || "";
    try {
      if (!target) throw new Error(s.kind === "google_news" ? "No search words set." : "No feed address set.");
      const items = parseFeed(await fetchText(target))
        .filter((i) => !i.published || new Date(i.published).getTime() >= cutoff)
        .slice(0, MAX_ITEMS_PER_SOURCE);
      if (items.length) {
        const rows = items.map((i) => ({
          business_id: s.business_id,
          source_id: s.id,
          kind: "news",
          title: i.title,
          url: i.url,
          source_name: i.source || s.name,
          summary: i.summary || null,
          published_at: i.published,
          dedupe_key: createHash("sha256").update(`${s.business_id}|${(i.url || i.title).toLowerCase()}`).digest("hex"),
        }));
        const inserted = await rest<{ id: string }[]>("office_feed_items?on_conflict=dedupe_key&select=id", {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
          body: JSON.stringify(rows),
        });
        added += inserted.length;
      }
      await rest(`office_feed_sources?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_fetched_at: new Date().toISOString(), last_error: null }) });
    } catch (e) {
      const msg = e instanceof Error ? (e.name === "TimeoutError" ? "Timed out." : e.message) : "Could not read the feed.";
      errors.push({ source: s.name, error: msg });
      await rest(`office_feed_sources?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_fetched_at: new Date().toISOString(), last_error: msg.slice(0, 300) }) }).catch(() => undefined);
    }
  }));
  return { sources: sources.length, added, errors };
}

type Unranked = { id: string; business_id: string | null; title: string; summary: string | null; source_name: string | null; published_at: string | null };

/** Score new items with the Feed Agent (or by recency when AI is off). */
export async function rankNewItems(rest: Rest) {
  const items = await rest<Unranked[]>(
    "office_feed_items?score=is.null&kind=eq.news&status=eq.new&select=id,business_id,title,summary,source_name,published_at&order=created_at.desc&limit=60",
  );
  if (!items.length) return { ranked: 0, ai: false };

  const patch = (id: string, change: object) =>
    rest(`office_feed_items?id=eq.${id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(change) });

  if (officeAiConfigured()) {
    try {
      const [businesses, goals] = await Promise.all([
        rest<{ id: string; slug: string; name: string; relationship: string; status: string; weekly_focus: string | null }[]>("office_businesses?select=id,slug,name,relationship,status,weekly_focus"),
        rest<{ business_id: string; title: string }[]>("office_goals?status=eq.open&level=in.(quarter,month,week)&select=business_id,title&limit=60"),
      ]);
      const slug = (id: string | null) => businesses.find((b) => b.id === id)?.slug || "";
      const { data } = await runFeedAgent(
        businesses.map((b) => ({ slug: b.slug, name: b.name, relationship: b.relationship, status: b.status, weekly_focus: b.weekly_focus, goals: goals.filter((g) => g.business_id === b.id).map((g) => g.title) })),
        items.map((it, i) => ({ i, business_slug: slug(it.business_id), title: it.title, source: it.source_name || "", summary: (it.summary || "").slice(0, 400), published: it.published_at || "" })),
      );
      const done = new Set<number>();
      for (const r of data.items || []) {
        const it = items[r.i];
        if (!it || done.has(r.i)) continue;
        done.add(r.i);
        const action = ["task", "reminder", "note"].includes(r.action_type) && r.action_title?.trim() ? { type: r.action_type, title: r.action_title.trim().slice(0, 200) } : null;
        await patch(it.id, { score: Math.max(0, Math.min(100, Math.round(r.score))), summary: r.summary?.trim().slice(0, 500) || it.summary, suggested_action: action });
      }
      // Anything the agent skipped still gets a score so it is not re-sent forever.
      await Promise.all(items.filter((_, i) => !done.has(i)).map((it) => patch(it.id, { score: 20 })));
      return { ranked: items.length, ai: true };
    } catch (e) {
      console.error("[office] feed agent failed, ranking by recency", e);
    }
  }
  await Promise.all(items.map((it) => {
    const ageDays = it.published_at ? (Date.now() - new Date(it.published_at).getTime()) / 86_400_000 : 7;
    return patch(it.id, { score: Math.max(10, Math.round(60 - ageDays * 4)) });
  }));
  return { ranked: items.length, ai: false };
}
