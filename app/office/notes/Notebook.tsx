"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { api } from "../../factory/connections/session";
import { officeDelete, officeInsert, officePatch, officeRest, type Note } from "../lib/client";

const NOTE_SELECT = "id,business_id,title,body,pinned,updated_at";

export default function Notebook() {
  const { businesses, error: bizError } = useBusinesses();
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const load = useCallback(async (select?: string) => {
    setError("");
    try {
      const rows = await officeRest<Note[]>(`office_notes?select=${NOTE_SELECT}&order=pinned.desc,updated_at.desc&limit=300`);
      setNotes(rows);
      if (select) setSelected(select);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load notes.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function newNote() {
    try {
      const n = await officeInsert<Note>("office_notes", { title: "", body: "", business_id: filter || null });
      await load(n.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a note.");
    }
  }

  const q = search.trim().toLowerCase();
  const shown = notes.filter((n) => (!filter || n.business_id === filter) && (!q || `${n.title} ${n.body}`.toLowerCase().includes(q)));
  const current = notes.find((n) => n.id === selected) || null;

  return (
    <section className={styles.page}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">Grow</span>
          <h1>Notebook</h1>
          <p>Ideas, meeting notes and thinking, filed by business. Turn any note into tasks with one click.</p>
        </div>
        <div className={styles.headerActions}><button className="button button-primary" onClick={() => void newNote()}>+ New note</button></div>
      </header>
      <ErrorBox message={bizError || error} />

      <div className={styles.notebook}>
        <aside className={styles.noteList}>
          <BusinessSelect businesses={businesses} value={filter} onChange={setFilter} noneLabel="All businesses" label="Filter" />
          <label className={styles.field}><span className={styles.srOnly}>Search notes</span><input type="search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          {loading && <p className={styles.muted}>Loading…</p>}
          {!loading && shown.length === 0 && <p className={styles.muted}>No notes.</p>}
          <ul>
            {shown.map((n) => (
              <li key={n.id}>
                <button type="button" className={n.id === selected ? styles.noteActive : undefined} onClick={() => setSelected(n.id)}>
                  <strong>{n.pinned ? "📌 " : ""}{n.title || n.body.split("\n")[0].slice(0, 60) || "Untitled"}</strong>
                  <span className={styles.taskMeta}>
                    <BizTag business={n.business_id ? byId.get(n.business_id) : undefined} />
                    <small className={styles.muted}>{new Date(n.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div>
          {current ? (
            <NoteEditor key={current.id} note={current} businesses={businesses} onSaved={() => load(current.id)} onDeleted={() => { setSelected(null); void load(); }} onError={setError} />
          ) : (
            <div className={`${styles.card} ${styles.muted}`}>Pick a note on the left, or start a new one.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function NoteEditor({ note, businesses, onSaved, onDeleted, onError }: {
  note: Note; businesses: ReturnType<typeof useBusinesses>["businesses"]; onSaved: () => Promise<void>; onDeleted: () => void; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [business, setBusiness] = useState(note.business_id || "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const dirty = title !== note.title || body !== note.body || business !== (note.business_id || "");

  async function save() {
    setBusy("save");
    setMsg("");
    try {
      await officePatch("office_notes", `id=eq.${note.id}`, { title: title.trim(), body, business_id: business || null });
      setMsg("Saved.");
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy("");
    }
  }
  async function toTasks() {
    if (dirty) await save();
    setBusy("tasks");
    setMsg("");
    try {
      const r = await api<{ created: number }>("/api/office/notes/tasks", { method: "POST", body: JSON.stringify({ note_id: note.id }) });
      setMsg(r.created ? `Created ${r.created} task${r.created === 1 ? "" : "s"}. See Tasks.` : "Nothing actionable found in this note.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create tasks.");
    } finally {
      setBusy("");
    }
  }
  async function remove() {
    if (!window.confirm("Delete this note? This cannot be undone.")) return;
    try { await officeDelete("office_notes", note.id); onDeleted(); } catch (e) { onError(e instanceof Error ? e.message : "Could not delete."); }
  }

  return (
    <article className={`${styles.card} ${styles.noteEditor}`}>
      <div className={styles.formGrid}>
        <label className={styles.field}>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Untitled" /></label>
        <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} />
      </div>
      <label className={styles.field}>
        <span className={styles.srOnly}>Note</span>
        <textarea rows={16} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write freely…" />
      </label>
      <div className={styles.rowEnd}>
        {msg && <small className={styles.muted} role="status">{msg}</small>}
        <button type="button" className={styles.linkButton} onClick={() => void remove()}>Delete</button>
        <button type="button" className={styles.linkButton} onClick={async () => { await officePatch("office_notes", `id=eq.${note.id}`, { pinned: !note.pinned }); await onSaved(); }}>{note.pinned ? "Unpin" : "Pin"}</button>
        <button type="button" className="button button-secondary" disabled={!!busy || (!body.trim() && !title.trim())} onClick={() => void toTasks()}>{busy === "tasks" ? "Reading…" : "Turn into tasks (AI)"}</button>
        <button type="button" className="button button-primary" disabled={!!busy || !dirty} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save"}</button>
      </div>
    </article>
  );
}
