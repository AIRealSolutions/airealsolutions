"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeDelete, officeInsert, officePatch, officeRest, prettyDate } from "../lib/client";
import { ASSET_SELECT, kindOf, libraryLinks, removeFromLibrary, uploadToLibrary, type Asset } from "../studio/types";

const KINDS: [string, string][] = [["", "All kinds"], ["logo", "Logos"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"], ["document", "Documents"], ["other", "Other"]];
const size = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

export default function LibraryBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [business, setBusiness] = useState("");
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [upBiz, setUpBiz] = useState("");
  const [upTags, setUpTags] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ tags: "", caption: "", campaign: "" });

  const load = useCallback(async () => {
    try {
      const a = await officeRest<Asset[]>(`office_assets?select=${ASSET_SELECT}${business ? `&business_id=eq.${business}` : ""}${kind ? `&kind=eq.${kind}` : ""}&order=created_at.desc&limit=300`);
      setAssets(a);
      setLinks(await libraryLinks(a.filter((x) => x.kind === "image" || x.kind === "logo").map((x) => x.storage_path)));
    } catch (e) {
      setError(e instanceof Error && /not in the database/i.test(e.message) ? "The Library isn't set up yet. Run docs/office-phase6.sql in Supabase." : e instanceof Error ? e.message : "Could not load the Library.");
    }
  }, [business, kind]);
  useEffect(() => { void load(); }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload");
    setMsg("");
    const tags = upTags.split(/[,]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
    let n = 0;
    try {
      for (const f of Array.from(files)) {
        const path = await uploadToLibrary(f, upBiz || "general");
        await officeInsert("office_assets", { business_id: upBiz || null, storage_path: path, file_name: f.name.slice(0, 200), mime: f.type || null, size_bytes: f.size, kind: kindOf(f.type || "", f.name), tags });
        n++;
      }
      setMsg(`Uploaded ${n} file${n === 1 ? "" : "s"}.`);
      await load();
    } catch (e) { setError(`${n ? `Uploaded ${n}, then: ` : ""}${e instanceof Error ? e.message : "Upload failed."}`); await load(); }
    finally { setBusy(""); }
  }
  async function open(a: Asset) {
    const l = links[a.storage_path] || (await libraryLinks([a.storage_path]))[a.storage_path];
    if (l) window.open(l, "_blank", "noopener"); else setError("Could not open the file.");
  }
  async function shareLink(a: Asset) {
    const l = (await libraryLinks([a.storage_path], 7 * 86400))[a.storage_path];
    if (!l) return setError("Could not make a link.");
    void navigator.clipboard?.writeText(l);
    setMsg(`A private link to ${a.file_name} that works for 7 days is copied.`);
  }
  async function remove(a: Asset) {
    if (!window.confirm(`Delete ${a.file_name}? Content using it loses the attachment.`)) return;
    try { await removeFromLibrary(a.storage_path); await officeDelete("office_assets", a.id); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not delete."); }
  }
  const shown = assets.filter((a) => !q || `${a.file_name} ${a.tags.join(" ")} ${a.caption || ""} ${a.campaign || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Grow</span>
        <h1>Library</h1>
        <p>Logos, photos, flyers, decks and video for every business, stored privately. Attach them to content, use a logo in a brand kit, or share a 7-day link.</p>
      </header>
      <ErrorBox message={bizError || error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <div className={`${styles.card} ${styles.addForm}`}>
        <div className={styles.formGrid4}>
          <BusinessSelect businesses={businesses} value={upBiz} onChange={setUpBiz} label="Upload for" noneLabel="General (all businesses)" />
          <label className={`${styles.field} ${styles.span2}`}>Tags (comma-separated)<input value={upTags} onChange={(e) => setUpTags(e.target.value)} placeholder="headshot, 2026 launch" /></label>
          <label className="button button-primary" style={{ alignSelf: "end", cursor: "pointer", textAlign: "center" }}>
            {busy === "upload" ? "Uploading…" : "Upload files"}<input type="file" multiple hidden onChange={(e) => { void upload(e.target.files); e.currentTarget.value = ""; }} />
          </label>
        </div>
        <small className={styles.muted}>Up to 50 MB per file. For longer videos, upload to YouTube and paste the link in the content piece.</small>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.formGrid4} style={{ flex: 1 }}>
          <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} noneLabel="All businesses" label="Business" />
          <label className={styles.field}>Kind<select value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className={`${styles.field} ${styles.span2}`}>Search<input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, tag, caption, campaign" /></label>
        </div>
      </div>

      {shown.length === 0 && !error && <p className={styles.muted}>No files yet.</p>}
      <div className={styles.libraryGrid}>
        {shown.map((a) => (
          <article key={a.id} className={`${styles.card} ${styles.libraryCard}`}>
            <button type="button" className={styles.libraryPreview} onClick={() => void open(a)} aria-label={`Open ${a.file_name}`}>
              {links[a.storage_path] ? <img src={links[a.storage_path]} alt={a.caption || a.file_name} /> : <span className={styles.thumbIcon}>{a.kind === "video" ? "🎞️" : a.kind === "audio" ? "🎧" : "📄"}</span>}
            </button>
            <strong className={styles.thumbName}>{a.file_name}</strong>
            <span className={styles.taskMeta}><BizTag business={businesses.find((b) => b.id === a.business_id)} /><small className={styles.muted}>{a.kind} · {size(a.size_bytes)} · {prettyDate(a.created_at.slice(0, 10))}</small></span>
            {a.tags.length > 0 && <small className={styles.muted}>{a.tags.map((t) => `#${t}`).join(" ")}</small>}
            {a.caption && <small>{a.caption}</small>}
            {editing === a.id ? (
              <div className={styles.stack} style={{ gap: 6 }}>
                <input className={styles.copyBox} value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} placeholder="tags, comma-separated" aria-label="Tags" />
                <input className={styles.copyBox} value={edit.campaign} onChange={(e) => setEdit({ ...edit, campaign: e.target.value })} placeholder="campaign" aria-label="Campaign" />
                <input className={styles.copyBox} value={edit.caption} onChange={(e) => setEdit({ ...edit, caption: e.target.value })} placeholder="caption / alt text" aria-label="Caption" />
                <div className={styles.rowEnd}>
                  <button type="button" className={styles.linkButton} onClick={() => setEditing(null)}>Cancel</button>
                  <button type="button" className="button button-secondary" onClick={async () => {
                    await officePatch("office_assets", `id=eq.${a.id}`, { tags: edit.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean), campaign: edit.campaign.trim() || null, caption: edit.caption.trim() || null });
                    setEditing(null); await load();
                  }}>Save</button>
                </div>
              </div>
            ) : (
              <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                <button type="button" className={styles.linkButton} onClick={() => { setEditing(a.id); setEdit({ tags: a.tags.join(", "), caption: a.caption || "", campaign: a.campaign || "" }); }}>Edit</button>
                <button type="button" className={styles.linkButton} onClick={() => void shareLink(a)}>Copy 7-day link</button>
                <button type="button" className={styles.linkButton} onClick={() => void remove(a)}>Delete</button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
