"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../office.module.css";
import { BizTag, ErrorBox } from "../../components";
import { useBusinesses } from "../../useBusinesses";
import { api } from "../../../factory/connections/session";
import { officeDelete, officeInsert, officePatch, officeRest, prettyDateTime } from "../../lib/client";
import {
  ASSET_SELECT, CHANNELS, CONTENT_SELECT, FORMATS, formatIcon, kindOf, libraryLinks, STATUSES, toLocalInput, uploadToLibrary,
  type Asset, type Content, type Draft, type Format, type Status,
} from "../types";

/** Which draft fields each format uses. */
const FIELDS: Record<Format, (keyof Draft)[]> = {
  reel: ["hook", "script", "beats", "shot_list", "caption", "hashtags", "cta"],
  short: ["hook", "script", "beats", "shot_list", "caption", "hashtags", "cta"],
  youtube: ["title_options", "hook", "script", "chapters", "description", "thumbnail", "hashtags", "cta"],
  post: ["caption", "hashtags", "cta"],
  carousel: ["beats", "caption", "hashtags", "cta"],
  blog: ["title_options", "script", "description", "cta"],
  email: ["email_subject", "hook", "script", "cta"],
  newsletter: ["email_subject", "hook", "script", "cta"],
};
const LABEL: Record<string, string> = {
  title_options: "Title options", hook: "Hook", script: "Script / body", beats: "Beats / slides", shot_list: "Shot list", caption: "Caption",
  hashtags: "Hashtags", cta: "Call to action", description: "Description", chapters: "Chapters", thumbnail: "Thumbnail idea", email_subject: "Subject line",
};
const LISTS = new Set(["title_options", "beats", "shot_list", "hashtags", "chapters"]);
const METRICS = ["views", "likes", "comments", "shares", "clicks", "leads"];

export default function ContentEditor({ id }: { id: string }) {
  const { businesses } = useBusinesses();
  const [c, setC] = useState<Content | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [assets, setAssets] = useState<Asset[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState("");
  const [url, setUrl] = useState("");
  const [metrics, setMetrics] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const x = (await officeRest<Content[]>(`office_content?id=eq.${id}&select=${CONTENT_SELECT}&limit=1`))[0];
      if (!x) { setError("Content not found."); return; }
      const a = await officeRest<Asset[]>(`office_assets?or=(business_id.eq.${x.business_id},business_id.is.null)&select=${ASSET_SELECT}&order=created_at.desc&limit=100`);
      setC(x); setDraft(x.draft || {}); setAssets(a); setDirty(false);
      setWhen(toLocalInput(x.scheduled_at)); setUrl(x.published_url || "");
      setMetrics(Object.fromEntries(METRICS.map((m) => [m, x.metrics?.[m] != null ? String(x.metrics[m]) : ""])));
      setLinks(await libraryLinks(a.filter((y) => y.kind === "image" || y.kind === "logo").map((y) => y.storage_path)));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const patch = async (change: Partial<Content>, note?: string) => {
    if (!c) return;
    try { await officePatch("office_content", `id=eq.${c.id}`, change); setC({ ...c, ...change }); if (note) setMsg(note); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  };
  async function saveDraft() { await patch({ draft }, "Saved."); setDirty(false); }
  async function write() {
    if (!c) return;
    if (dirty) await saveDraft();
    setBusy("write");
    setMsg("");
    try {
      const r = await api<{ content: Content }>("/api/office/studio/write", { method: "POST", body: JSON.stringify({ content_id: c.id }) });
      setC(r.content); setDraft(r.content.draft); setDirty(false);
      setMsg("Drafted in the brand's voice. Fill any [add: …] placeholders before publishing.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not write it."); }
    finally { setBusy(""); }
  }
  async function schedule() {
    if (!c || !when) return setError("Pick a date and time.");
    const at = new Date(when).toISOString();
    await patch({ scheduled_at: at, status: "scheduled" });
    await officeInsert("office_reminders", { title: `Publish: ${c.title}${c.channels.length ? ` (${c.channels.join(", ")})` : ""}`, business_id: c.business_id, remind_at: at }).catch(() => undefined);
    setMsg(`Scheduled for ${prettyDateTime(at)}. A reminder will show on Today; the Studio doesn't post for you yet.`);
  }
  async function publish() {
    if (!c) return;
    if (url && !/^https?:\/\//i.test(url)) return setError("The link should start with https://");
    await patch({ status: "published", published_at: new Date().toISOString(), published_url: url || null }, "Marked published.");
  }
  async function saveMetrics() {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(metrics)) if (v.trim() !== "" && Number.isFinite(Number(v))) m[k] = Math.max(0, Math.round(Number(v)));
    await patch({ metrics: m }, "Results saved.");
  }
  async function upload(files: FileList | null) {
    if (!c || !files?.length) return;
    setBusy("upload");
    try {
      const ids: string[] = [];
      for (const f of Array.from(files)) {
        const path = await uploadToLibrary(f, `${c.business_id}`);
        const a = await officeInsert<Asset>("office_assets", { business_id: c.business_id, storage_path: path, file_name: f.name.slice(0, 200), mime: f.type || null, size_bytes: f.size, kind: kindOf(f.type || "", f.name) });
        ids.push(a.id);
      }
      await patch({ asset_ids: [...c.asset_ids, ...ids] }, `Uploaded ${ids.length} file${ids.length === 1 ? "" : "s"} to the Library and attached them.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed."); }
    finally { setBusy(""); }
  }
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text); setMsg(`${what} copied.`); };

  if (!c) return <section className={styles.page}><ErrorBox message={error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;
  const biz = businesses.find((b) => b.id === c.business_id);
  const fields = FIELDS[c.format];
  const setField = (k: keyof Draft, v: string) => { setDraft({ ...draft, [k]: LISTS.has(k) ? v.split("\n").map((x) => x.trimEnd()).filter((x, i, arr) => x || i < arr.length - 1) : v }); setDirty(true); };
  const fieldText = (k: keyof Draft) => { const v = draft[k]; return Array.isArray(v) ? v.join("\n") : (v as string) || ""; };
  const captionAll = [draft.caption, (draft.hashtags || []).join(" ")].filter(Boolean).join("\n\n");
  const attached = assets.filter((a) => c.asset_ids.includes(a.id));

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <a className={styles.smallLink} href="/office/studio">← Content Studio</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className={styles.taskMeta}><span className="product-tag" style={{ margin: 0 }}>{formatIcon(c.format)} {FORMATS.find(([k]) => k === c.format)?.[1]}</span><BizTag business={biz} /></span>
          <input className={styles.titleInput} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} onBlur={() => void patch({ title: c.title.trim() || "Untitled" })} aria-label="Title" />
        </div>
        <div className={styles.headerActions}>
          <label className={styles.field}>Status
            <select value={c.status} onChange={(e) => void patch({ status: e.target.value as Status })}>{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </label>
        </div>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={styles.twoCol} style={{ marginTop: 0 }}>
        <div className={styles.stack}>
          <article className={styles.card}>
            <div className={styles.formGrid}>
              <label className={styles.field}>Format
                <select value={c.format} onChange={(e) => void patch({ format: e.target.value as Format })}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <fieldset className={styles.dayPicker}>
                <legend>Channels</legend>
                {CHANNELS.map(([k, l]) => (
                  <label key={k}><input type="checkbox" checked={c.channels.includes(k)} onChange={(e) => void patch({ channels: e.target.checked ? [...c.channels, k] : c.channels.filter((x) => x !== k) })} />{l}</label>
                ))}
              </fieldset>
            </div>
            <label className={styles.field}>Brief / angle<textarea rows={3} value={c.idea || ""} onChange={(e) => setC({ ...c, idea: e.target.value })} onBlur={() => void patch({ idea: c.idea?.trim() || null })} placeholder="What it says and why someone would stop scrolling." /></label>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}>
              <div><h2>Draft</h2>{draft.written_at && <small className={styles.muted}>Written by AI {prettyDateTime(draft.written_at)}</small>}</div>
              <div className={styles.rowActions}>
                <button className="button button-secondary" disabled={!!busy} onClick={() => void write()}>{busy === "write" ? "Writing…" : draft.written_at ? "Rewrite with AI" : "Write with AI"}</button>
                <button className="button button-primary" disabled={!dirty} onClick={() => void saveDraft()}>Save</button>
              </div>
            </div>
            {fields.map((k) => (
              <label key={k} className={styles.field}>
                <span className={styles.taskMeta}>{LABEL[k]}{LISTS.has(k) && <small className={styles.muted} style={{ fontWeight: 400 }}>one per line</small>}</span>
                <textarea rows={k === "script" ? 12 : LISTS.has(k) ? 5 : k === "caption" || k === "description" ? 5 : 2} value={fieldText(k)} onChange={(e) => setField(k, e.target.value)} />
              </label>
            ))}
            <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
              {captionAll && <button type="button" className={styles.linkButton} onClick={() => copy(captionAll, "Caption and hashtags")}>Copy caption + hashtags</button>}
              {draft.script && <button type="button" className={styles.linkButton} onClick={() => copy(draft.script || "", "Script")}>Copy script</button>}
              {draft.description && <button type="button" className={styles.linkButton} onClick={() => copy([draft.description, (draft.chapters || []).join("\n")].filter(Boolean).join("\n\n"), "Description and chapters")}>Copy description</button>}
            </div>
          </article>
        </div>

        <div className={styles.stack}>
          <article className={styles.card}>
            <h2>Publish</h2>
            <div className={styles.formGrid}>
              <label className={styles.field}>Publish on<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
              <div style={{ alignSelf: "end" }}><button className="button button-secondary" onClick={() => void schedule()}>Schedule</button></div>
              <label className={styles.field}>Published link<input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>
              <div style={{ alignSelf: "end" }}><button className="button button-primary" onClick={() => void publish()}>Mark published</button></div>
            </div>
            {c.published_at && <small className={styles.muted}>Published {prettyDateTime(c.published_at)}{c.published_url && /^https?:\/\//i.test(c.published_url) ? <> · <a className={styles.smallLink} href={c.published_url} target="_blank" rel="noopener noreferrer">open</a></> : ""}</small>}
            <small className={styles.muted}>Posting directly to Facebook, Instagram and YouTube comes later; for now copy the draft into each app.</small>
          </article>

          <article className={styles.card}>
            <div className={styles.cardHead}><h2>Media</h2><label className="button button-secondary" style={{ cursor: "pointer" }}>{busy === "upload" ? "Uploading…" : "Upload"}<input type="file" multiple hidden onChange={(e) => void upload(e.target.files)} /></label></div>
            {attached.length === 0 && <p className={styles.muted}>Nothing attached. Upload here, or attach from the Library below.</p>}
            <div className={styles.thumbGrid}>
              {attached.map((a) => (
                <figure key={a.id} className={styles.thumb}>
                  {links[a.storage_path] ? <img src={links[a.storage_path]} alt={a.caption || a.file_name} /> : <span className={styles.thumbIcon}>{a.kind === "video" ? "🎞️" : "📄"}</span>}
                  <figcaption>{a.file_name}<button type="button" className={styles.linkButton} onClick={() => void patch({ asset_ids: c.asset_ids.filter((x) => x !== a.id) })}>Remove</button></figcaption>
                </figure>
              ))}
            </div>
            {assets.some((a) => !c.asset_ids.includes(a.id)) && (
              <details>
                <summary className={styles.smallLink}>Attach from the Library</summary>
                <div className={styles.thumbGrid}>
                  {assets.filter((a) => !c.asset_ids.includes(a.id)).slice(0, 24).map((a) => (
                    <button key={a.id} type="button" className={styles.thumb} onClick={() => void patch({ asset_ids: [...c.asset_ids, a.id] })} title={`Attach ${a.file_name}`}>
                      {links[a.storage_path] ? <img src={links[a.storage_path]} alt="" /> : <span className={styles.thumbIcon}>{a.kind === "video" ? "🎞️" : "📄"}</span>}
                      <span className={styles.thumbName}>{a.file_name}</span>
                    </button>
                  ))}
                </div>
              </details>
            )}
          </article>

          <article className={styles.card}>
            <h2>Results</h2>
            <div className={styles.formGrid}>
              {METRICS.map((m) => <label key={m} className={styles.field}>{m[0].toUpperCase() + m.slice(1)}<input inputMode="numeric" value={metrics[m] || ""} onChange={(e) => setMetrics({ ...metrics, [m]: e.target.value })} /></label>)}
            </div>
            <div className={styles.rowEnd}><button className="button button-secondary" onClick={() => void saveMetrics()}>Save results</button></div>
          </article>

          <button type="button" className={styles.linkButton} style={{ justifySelf: "start" }} onClick={async () => { if (!window.confirm("Delete this content piece? Its media stays in the Library.")) return; try { await officeDelete("office_content", c.id); window.location.assign("/office/studio"); } catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); } }}>Delete</button>
        </div>
      </div>
    </section>
  );
}
