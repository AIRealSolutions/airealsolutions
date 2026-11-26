"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../../office.module.css";
import { api } from "../../../factory/connections/session";
import { officePatch, officeRest, prettyDateTime } from "../../lib/client";
import { ACCOUNT_SELECT, PROVIDERS, PUBLICATION_SELECT, toLocalInput, type Asset, type Content, type Publication, type SocialAccount } from "../types";

const STATUS_LABEL: Record<Publication["status"], string> = { queued: "Scheduled", processing: "Processing", published: "Posted", failed: "Failed", cancelled: "Cancelled" };

/** Post straight to the business's connected channels, now or at a set time, and watch each one go out. */
export default function Publish({ content, attached, onChanged }: { content: Content; attached: Asset[]; onChanged: () => Promise<void> }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [privacy, setPrivacy] = useState("public");
  const [when, setWhen] = useState(toLocalInput(content.scheduled_at));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);
  const polling = useRef(false);

  const load = useCallback(async () => {
    try {
      const [a, p] = await Promise.all([
        officeRest<SocialAccount[]>(`office_social_accounts?or=(business_id.eq.${content.business_id},business_id.is.null)&select=${ACCOUNT_SELECT}&order=provider.asc`),
        officeRest<Publication[]>(`office_publications?content_id=eq.${content.id}&select=${PUBLICATION_SELECT}&order=created_at.asc`),
      ]);
      setAccounts(a); setPubs(p); setMissing(false);
      setChosen((c) => (c.length ? c : a.filter((x) => x.business_id === content.business_id && content.channels.includes(x.provider)).map((x) => x.id)));
    } catch (e) { if (e instanceof Error && /not in the database/i.test(e.message)) setMissing(true); else setError(e instanceof Error ? e.message : "Could not load channels."); }
  }, [content.id, content.business_id, content.channels]);
  useEffect(() => { void load(); }, [load]);

  // While Instagram (or a due post) is still working, nudge the runner and refresh every 10 seconds.
  const waiting = pubs.some((p) => p.status === "processing" || (p.status === "queued" && new Date(p.publish_at).getTime() <= Date.now()));
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(async () => {
      if (polling.current) return;
      polling.current = true;
      try { await api("/api/office/social/run", { method: "POST", body: JSON.stringify({ content_id: content.id }) }); } catch { /* shown on the row */ }
      polling.current = false;
      await load(); await onChanged();
    }, 10_000);
    return () => clearInterval(t);
  }, [waiting, content.id, load, onChanged]);

  async function go(now: boolean, ids: string[] = chosen) {
    setError(""); setMsg("");
    if (!ids.length) return setError("Pick at least one channel.");
    if (!now && !when) return setError("Pick a date and time, or publish now.");
    const at = now ? null : new Date(when).toISOString();
    if (at && new Date(at).getTime() < Date.now() - 60_000) return setError("That time has passed. Publish now instead, or pick a later time.");
    const labels = accounts.filter((a) => ids.includes(a.id)).map((a) => a.name).join(", ");
    if (now && !window.confirm(`Post "${content.title}" to ${labels} now?`)) return;
    setBusy(now ? "now" : "later");
    try {
      const r = await api<{ result: { published: number; processing: number; failed: number; errors: string[] } | null; scheduled_for: string | null }>("/api/office/social/publish", {
        method: "POST",
        body: JSON.stringify({ content_id: content.id, account_ids: ids, publish_at: at, privacy, asset_ids: attached.map((a) => a.id) }),
      });
      if (r.result) {
        const { published, processing, failed, errors } = r.result;
        setMsg([published && `Posted to ${published} channel${published === 1 ? "" : "s"}.`, processing && `${processing} still processing; this page will finish it.`, failed && `${failed} failed: ${errors.join(" · ")}`].filter(Boolean).join(" "));
      } else {
        await officePatch("office_content", `id=eq.${content.id}`, { scheduled_at: at });
        setMsg(`Scheduled for ${prettyDateTime(r.scheduled_for!)}. It goes out on its own (see the Phase 7 scheduler note), or the next time the Studio is open after that time.`);
      }
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not publish."); }
    finally { setBusy(""); }
  }
  async function cancel(p: Publication) {
    try { await officePatch("office_publications", `id=eq.${p.id}&status=eq.queued`, { status: "cancelled" }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not cancel."); }
  }
  async function refresh() {
    setBusy("metrics"); setError("");
    try {
      const r = await api<{ updated: number; errors: string[] }>("/api/office/social/metrics", { method: "POST", body: JSON.stringify({ content_id: content.id }) });
      setMsg(r.errors.length ? `Updated ${r.updated}. ${r.errors.join(" · ")}` : `Results updated from ${r.updated} channel${r.updated === 1 ? "" : "s"}.`);
      await load(); await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not refresh results."); }
    finally { setBusy(""); }
  }

  if (missing) return <p className={styles.muted}>Run docs/office-phase7.sql in Supabase to post straight to YouTube, Facebook and Instagram.</p>;
  const hasVideo = attached.some((a) => a.kind === "video");
  const hasPhoto = attached.some((a) => a.kind === "image" || a.kind === "logo");
  const picked = accounts.filter((a) => chosen.includes(a.id));
  const warn = [
    picked.some((a) => a.provider === "youtube") && !hasVideo && "YouTube needs a video attached.",
    picked.some((a) => a.provider === "instagram") && !hasVideo && !hasPhoto && "Instagram needs a photo or video attached.",
  ].filter(Boolean) as string[];
  const published = pubs.filter((p) => p.status === "published");

  return (
    <div className={styles.stack} style={{ gap: 10 }}>
      {error && <div className={styles.alert} role="alert">{error}</div>}
      {msg && <div className={styles.note} role="status" style={{ marginBottom: 0 }}>{msg}</div>}
      {accounts.length === 0 ? (
        <p className={styles.muted}>No channels connected for this business. <a className={styles.smallLink} href="/office/studio" onClick={() => { try { localStorage.setItem("office.studio.tab", "channels"); } catch { /* ignore */ } }}>Connect YouTube, Facebook or Instagram</a>.</p>
      ) : (
        <>
          <fieldset className={styles.dayPicker}>
            <legend>Post to</legend>
            {accounts.map((a) => (
              <label key={a.id} title={a.status === "error" ? a.last_error || "" : undefined}>
                <input type="checkbox" checked={chosen.includes(a.id)} disabled={a.status === "error"} onChange={(e) => setChosen(e.target.checked ? [...chosen, a.id] : chosen.filter((x) => x !== a.id))} />
                {PROVIDERS[a.provider].icon} {a.name}{!a.business_id && " (unassigned)"}{a.status === "error" && " — reconnect"}
              </label>
            ))}
          </fieldset>
          <div className={styles.formGrid}>
            {picked.some((a) => a.provider === "youtube") && (
              <label className={styles.field}>YouTube visibility
                <select value={privacy} onChange={(e) => setPrivacy(e.target.value)}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select>
              </label>
            )}
            <label className={styles.field}>Publish on<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
          </div>
          {warn.map((w) => <small key={w} style={{ color: "#92400e" }}>{w}</small>)}
          <small className={styles.muted}>Sends the caption, hashtags and call to action from the draft, with the media attached below (the first video, or up to 10 photos).</small>
          <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
            <button className="button button-primary" disabled={!!busy || !chosen.length} onClick={() => void go(true)}>{busy === "now" ? "Posting…" : "Publish now"}</button>
            <button className="button button-secondary" disabled={!!busy || !chosen.length || !when} onClick={() => void go(false)}>{busy === "later" ? "Scheduling…" : "Schedule"}</button>
          </div>
        </>
      )}
      {pubs.length > 0 && (
        <ul className={styles.pubList}>
          {pubs.map((p) => (
            <li key={p.id}>
              <span>{PROVIDERS[p.provider]?.icon} {p.account_name}</span>
              <span className={styles.rowActions}>
                <span className={styles.pubStatus} data-s={p.status}>{STATUS_LABEL[p.status]}</span>
                <small className={styles.muted}>{p.status === "published" && p.published_at ? prettyDateTime(p.published_at) : p.status === "queued" ? prettyDateTime(p.publish_at) : ""}</small>
                {p.external_url && /^https:\/\//.test(p.external_url) && <a className={styles.smallLink} href={p.external_url} target="_blank" rel="noopener noreferrer">open</a>}
                {p.status === "queued" && <button type="button" className={styles.linkButton} onClick={() => void cancel(p)}>Cancel</button>}
                {p.status === "failed" && p.account_id && <button type="button" className={styles.linkButton} disabled={!!busy} onClick={() => void go(true, [p.account_id!])}>Retry</button>}
              </span>
              {p.error && p.status === "failed" && <small style={{ color: "#991b1b", flexBasis: "100%" }}>{p.error}</small>}
              {p.status === "published" && Object.keys(p.metrics || {}).length > 0 && (
                <small className={styles.muted} style={{ flexBasis: "100%" }}>{Object.entries(p.metrics).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(" · ")}</small>
              )}
            </li>
          ))}
        </ul>
      )}
      {published.length > 0 && (
        <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
          <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void refresh()}>{busy === "metrics" ? "Refreshing…" : "Refresh results from channels"}</button>
          <small className={styles.muted}>Results also refresh on their own every morning.</small>
        </div>
      )}
    </div>
  );
}
