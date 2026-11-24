"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { api } from "../../factory/connections/session";
import { officeDelete, officeInsert, officePatch, officeRest, officeToday, prettyDateTime, type Business } from "../lib/client";

type Item = {
  id: string; business_id: string | null; kind: "news" | "internal"; title: string; url: string | null; source_name: string | null;
  summary: string | null; published_at: string | null; created_at: string; score: number | null;
  suggested_action: { type: "task" | "reminder" | "note"; title: string } | null; status: "new" | "saved" | "actioned" | "dismissed";
};
type Source = { id: string; business_id: string; kind: "rss" | "google_news"; name: string; config: { url?: string; query?: string }; active: boolean; last_fetched_at: string | null; last_error: string | null };
type Tab = "new" | "saved" | "done";
const ITEM_SELECT = "id,business_id,kind,title,url,source_name,summary,published_at,created_at,score,suggested_action,status";
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

export default function FeedBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [items, setItems] = useState<Item[]>([]);
  const [tab, setTab] = useState<Tab>("new");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const load = useCallback(async () => {
    setError("");
    try {
      const status = tab === "new" ? "eq.new" : tab === "saved" ? "eq.saved" : "in.(actioned,dismissed)";
      const order = tab === "new" ? "score.desc.nullslast,created_at.desc" : "updated_at.desc";
      setItems(await officeRest<Item[]>(`office_feed_items?status=${status}${filter ? `&business_id=eq.${filter}` : ""}&select=${ITEM_SELECT}&order=${order}&limit=150`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the feed.");
    } finally {
      setLoading(false);
    }
  }, [tab, filter]);
  useEffect(() => { void load(); }, [load]);

  async function refresh() {
    setRefreshing(true);
    setMsg("");
    setError("");
    try {
      const r = await api<{ sources: number; added: number; ranked: number; ai: boolean; errors: { source: string; error: string }[] }>(
        "/api/office/feed/refresh", { method: "POST", body: JSON.stringify(filter ? { business_id: filter } : {}) },
      );
      setMsg(`Checked ${r.sources} source${r.sources === 1 ? "" : "s"}: ${r.added} new item${r.added === 1 ? "" : "s"}${r.ranked ? `, ${r.ranked} ranked${r.ai ? " by AI" : " by date"}` : ""}.` +
        (r.errors.length ? ` Problems: ${r.errors.map((e) => `${e.source} (${e.error})`).join("; ")}.` : ""));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not refresh.");
    } finally {
      setRefreshing(false);
    }
  }

  const setStatus = async (it: Item, status: Item["status"]) => {
    try { await officePatch("office_feed_items", `id=eq.${it.id}`, { status }); setItems((l) => l.filter((x) => x.id !== it.id)); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update."); }
  };

  async function act(it: Item) {
    const a = it.suggested_action;
    if (!a) return;
    try {
      const note = [it.title, safeHref(it.url)].filter(Boolean).join("\n");
      if (a.type === "task") await officeInsert("office_tasks", { title: a.title, business_id: it.business_id, notes: note, source: "ai", due_on: officeToday() });
      else if (a.type === "reminder") await officeInsert("office_reminders", { title: a.title, business_id: it.business_id, notes: note, remind_at: new Date(Date.now() + 86_400_000).toISOString() });
      else await officeInsert("office_notes", { title: a.title, body: `${note}\n\n${it.summary || ""}`.trim(), business_id: it.business_id });
      await officePatch("office_feed_items", `id=eq.${it.id}`, { status: "actioned" });
      setItems((l) => l.filter((x) => x.id !== it.id));
      setMsg(`Added a ${a.type}: ${a.title}${a.type === "reminder" ? " (tomorrow, change it on Reminders)" : ""}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add it.");
    }
  }

  return (
    <section className={styles.page}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">Run</span>
          <h1>Feed</h1>
          <p>News and activity for each business, ranked by how much it matters. One click turns an item into a task, reminder or note.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="button button-primary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Checking sources…" : "Refresh now"}</button>
        </div>
      </header>
      <ErrorBox message={bizError || error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Show">
          {([["new", "New"], ["saved", "Saved"], ["done", "Done"]] as [Tab, string][]).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={tab === v} className={tab === v ? styles.seg_focus : undefined} onClick={() => setTab(v)}>{label}</button>
          ))}
        </div>
        <div className={styles.toolbarField}><BusinessSelect businesses={businesses} value={filter} onChange={setFilter} noneLabel="All businesses" label="Filter" /></div>
      </div>

      {loading && <p className={styles.muted}>Loading…</p>}
      {!loading && items.length === 0 && (
        <p className={styles.muted}>{tab === "new" ? "Nothing new. Press Refresh now, or add sources below." : "Nothing here."}</p>
      )}
      <ul className={styles.feedList}>
        {items.map((it) => {
          const band = it.score == null ? null : it.score >= 80 ? "high" : it.score >= 50 ? "mid" : "low";
          return (
            <li key={it.id} className={styles.card}>
              <div className={styles.feedHead}>
                {band && <span className={`${styles.score} ${styles[`score_${band}`]}`} title={`Score ${it.score}`}>{band === "high" ? "Act" : band === "mid" ? "Read" : "FYI"}</span>}
                {it.kind === "internal" && <span className={`${styles.score} ${styles.score_mid}`}>Office</span>}
                {safeHref(it.url) ? (
                  <a href={safeHref(it.url)} target="_blank" rel="noopener noreferrer nofollow" className={styles.feedTitle}>{it.title}</a>
                ) : <strong className={styles.feedTitle}>{it.title}</strong>}
              </div>
              <span className={styles.taskMeta}>
                <BizTag business={it.business_id ? byId.get(it.business_id) : undefined} />
                {it.source_name && <small className={styles.muted}>{it.source_name}</small>}
                <small className={styles.muted}>{prettyDateTime(it.published_at || it.created_at)}</small>
              </span>
              {it.summary && <p>{it.summary}</p>}
              <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                {it.suggested_action && it.status !== "actioned" && (
                  <button type="button" className="button button-secondary" onClick={() => void act(it)}>
                    + {it.suggested_action.type}: {it.suggested_action.title}
                  </button>
                )}
                {it.status !== "saved" && it.status !== "actioned" && <button type="button" className={styles.linkButton} onClick={() => void setStatus(it, "saved")}>Save</button>}
                {it.status !== "dismissed" && <button type="button" className={styles.linkButton} onClick={() => void setStatus(it, "dismissed")}>Dismiss</button>}
                {(it.status === "dismissed" || it.status === "saved") && <button type="button" className={styles.linkButton} onClick={() => void setStatus(it, "new")}>Move to New</button>}
              </div>
            </li>
          );
        })}
      </ul>

      <Sources businesses={businesses} onError={setError} />
    </section>
  );
}

function Sources({ businesses, onError }: { businesses: Business[]; onError: (m: string) => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [business, setBusiness] = useState("");
  const [kind, setKind] = useState<Source["kind"]>("google_news");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const load = useCallback(async () => {
    try { setSources(await officeRest<Source[]>("office_feed_sources?select=id,business_id,kind,name,config,active,last_fetched_at,last_error&order=created_at.asc")); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load sources."); }
  }, [onError]);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return onError("Pick the business this source is for.");
    if (kind === "rss" && !/^https?:\/\//i.test(value.trim())) return onError("A feed address starts with https://");
    try {
      await officeInsert("office_feed_sources", { business_id: business, kind, name: name.trim() || value.trim().slice(0, 60), config: kind === "rss" ? { url: value.trim() } : { query: value.trim() } });
      setName(""); setValue("");
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the source.");
    }
  }

  return (
    <details className={`${styles.card} ${styles.sources}`}>
      <summary><h2>Sources ({sources.length})</h2><small className={styles.muted}>News searches and RSS feeds for each business</small></summary>
      <ul className={styles.plainList}>
        {sources.map((s) => (
          <li key={s.id} className={styles.reminderRow}>
            <div>
              <strong>{s.name}</strong>
              <span className={styles.taskMeta}>
                <BizTag business={businesses.find((b) => b.id === s.business_id)} />
                <small className={styles.muted}>{s.kind === "google_news" ? `News search: ${s.config.query}` : s.config.url}</small>
              </span>
              <small className={s.last_error ? styles.overdue : styles.muted}>
                {s.last_error ? `Last check failed: ${s.last_error}` : s.last_fetched_at ? `Checked ${prettyDateTime(s.last_fetched_at)}` : "Not checked yet"}
              </small>
            </div>
            <div className={styles.rowActions}>
              <label className={styles.check} style={{ margin: 0 }}>
                <input type="checkbox" checked={s.active} onChange={async () => { await officePatch("office_feed_sources", `id=eq.${s.id}`, { active: !s.active }); await load(); }} /> On
              </label>
              <button type="button" className={styles.linkButton} onClick={async () => { if (window.confirm(`Delete “${s.name}”? Its items stay in the feed.`)) { await officeDelete("office_feed_sources", s.id); await load(); } }}>Delete</button>
            </div>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className={styles.formGrid4} style={{ marginTop: 12 }}>
        <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} noneLabel="Choose…" />
        <label className={styles.field}>Type
          <select value={kind} onChange={(e) => setKind(e.target.value as Source["kind"])}>
            <option value="google_news">News search (Google News)</option>
            <option value="rss">RSS / Atom feed address</option>
          </select>
        </label>
        <label className={styles.field}>{kind === "rss" ? "Feed address" : "Search words"}
          <input value={value} onChange={(e) => setValue(e.target.value)} required placeholder={kind === "rss" ? "https://example.com/feed.xml" : '"county" cemetery RFP'} />
        </label>
        <label className={styles.field}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Short label" /></label>
        <div className={styles.rowEnd} style={{ gridColumn: "1 / -1" }}><button className="button button-primary" type="submit">Add source</button></div>
      </form>
    </details>
  );
}
