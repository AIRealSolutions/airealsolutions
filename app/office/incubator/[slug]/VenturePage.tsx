"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../../office.module.css";
import { ErrorBox } from "../../components";
import { api } from "../../../factory/connections/session";
import { officeInsert, officePatch, officeRest, officeRpc, officeToday, prettyDate, prettyDateTime, type Business } from "../../lib/client";
import { DOC_LABEL, DOC_SECTIONS, docKindsFor, type DocKind } from "../../../lib/office/venture-docs";
import { Meter } from "../IncubatorBoard";
import {
  CATEGORIES, ITEM_SELECT, readiness, SALE_MODELS, stagesFor, TRACK_LABEL, VENTURE_SELECT,
  type Chat, type Doc, type Gap, type Item, type Review, type Track, type Venture,
} from "../types";

type Tab = Track | DocKind | "advisor";
const toCents = (v: string) => { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const quarterEnd = (d: string) => { const y = Number(d.slice(0, 4)), q = Math.floor((Number(d.slice(5, 7)) - 1) / 3); return new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10); };
const catLabel = (c: string) => CATEGORIES.find(([k]) => k === c)?.[1] || c;

export default function VenturePage({ slug }: { slug: string }) {
  const [biz, setBiz] = useState<Business | null>(null);
  const [venture, setVenture] = useState<Venture | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<Tab>("production");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const b = (await officeRest<Business[]>(`office_businesses?slug=eq.${encodeURIComponent(slug)}&select=id,entity_id,name,slug,relationship,category,status,website,summary,weekly_focus,factory_project_id,sort_order&limit=1`))[0];
      if (!b) { setError("Business not found."); return; }
      let [v, i] = await Promise.all([
        officeRest<Venture[]>(`office_ventures?business_id=eq.${b.id}&select=${VENTURE_SELECT}`),
        officeRest<Item[]>(`office_readiness_items?business_id=eq.${b.id}&select=${ITEM_SELECT}&order=sort_order.asc,created_at.asc`),
      ]);
      if (!v[0]) {
        await officeInsert("office_ventures", { business_id: b.id, stage: "idea" });
        await officeRpc("office_seed_production", { p_business: b.id });
        if (b.relationship !== "client") await officeRpc("office_seed_readiness", { p_business: b.id });
        [v, i] = await Promise.all([
          officeRest<Venture[]>(`office_ventures?business_id=eq.${b.id}&select=${VENTURE_SELECT}`),
          officeRest<Item[]>(`office_readiness_items?business_id=eq.${b.id}&select=${ITEM_SELECT}&order=sort_order.asc,created_at.asc`),
        ]);
      }
      const d = await officeRest<Doc[]>(`office_venture_docs?business_id=eq.${b.id}&select=*&order=version.desc`);
      setBiz(b); setVenture(v[0]); setItems(i); setDocs(d);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not load.";
      setError(/production_goal_id|track/.test(m) ? "Run docs/office-readiness.sql in Supabase to add production readiness and AI reviews." : m);
    }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  /** The goal that tracks a checklist ("Ready for production"/"Ready to sell <name>"), created on first use. */
  const ensureGoal = useCallback(async (track: Track): Promise<string> => {
    if (!biz || !venture) throw new Error("Not loaded.");
    const existing = track === "production" ? venture.production_goal_id : venture.goal_id;
    if (existing) return existing;
    const r = readiness(items, track);
    const g = await officeInsert<{ id: string }>("office_goals", {
      business_id: biz.id, level: "quarter", title: `${track === "production" ? "Ready for production" : "Ready to sell"}: ${biz.name}`,
      due_on: quarterEnd(officeToday()), target_value: r.total, current_value: r.done, unit: "items",
    });
    const field = track === "production" ? "production_goal_id" : "goal_id";
    await officePatch("office_ventures", `business_id=eq.${biz.id}`, { [field]: g.id });
    setVenture({ ...venture, [field]: g.id });
    return g.id;
  }, [biz, venture, items]);

  /** Add AI-suggested items to a checklist. */
  const addItems = useCallback(async (gaps: Gap[]) => {
    if (!biz) return;
    try {
      for (const g of gaps) {
        await officeRest("office_readiness_items?on_conflict=business_id,track,title", {
          method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ business_id: biz.id, track: biz.relationship === "client" ? "production" : g.track, category: g.category, title: g.title, detail: g.detail || null, source: "ai", sort_order: 200 }),
        });
      }
      setMsg(`Added ${gaps.length} item${gaps.length === 1 ? "" : "s"} to the checklist.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not add."); }
  }, [biz, load]);

  if (!biz || !venture) return <section className={styles.page}><ErrorBox message={error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;
  const owned = biz.relationship !== "client";
  const kinds = docKindsFor(biz.relationship);
  const tabs: [Tab, string][] = [["production", "Production readiness"], ...(owned ? [["sale", "Sale readiness"] as [Tab, string]] : []), ...kinds.map((k) => [k, DOC_LABEL[k]] as [Tab, string]), ["advisor", "Advisor"]];

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <a className={styles.smallLink} href="/office/incubator">← Incubator</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="product-tag">{owned ? "Owned by AI Real Solutions" : "Client"} · Incubator</span>
          <h1>{biz.name}</h1>
          <div className={styles.meterRow}>
            <Meter label="Ready for production" items={items} track="production" />
            {owned && <Meter label="Ready to sell" items={items} track="sale" />}
          </div>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.field}>Stage
            <select value={venture.stage} onChange={async (e) => { const stage = e.target.value as Venture["stage"]; await officePatch("office_ventures", `business_id=eq.${biz.id}`, { stage }); setVenture({ ...venture, stage }); }}>
              {stagesFor(biz.relationship).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}
      <div className={styles.tabs} role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => { setTab(k); setMsg(""); }}>{l}</button>)}
      </div>
      {(tab === "production" || tab === "sale") && <Readiness key={tab} track={tab} biz={biz} items={items.filter((i) => i.track === tab)} docs={docs} ensureGoal={ensureGoal} addItems={addItems} onChanged={load} onMsg={setMsg} onError={setError} />}
      {tab === "license_offer" && <Licensing biz={biz} venture={venture} onSaved={(v) => setVenture(v)} onError={setError} />}
      {kinds.includes(tab as DocKind) && <DocEditor key={tab} biz={biz} kind={tab as DocKind} docs={docs.filter((d) => d.kind === tab)} items={items} addItems={addItems} onChanged={load} onMsg={setMsg} onError={setError} />}
      {tab === "advisor" && <Advisor biz={biz} ensureGoal={ensureGoal} addItems={addItems} onError={setError} />}
    </section>
  );
}

function Readiness({ track, biz, items, docs, ensureGoal, addItems, onChanged, onMsg, onError }: {
  track: Track; biz: Business; items: Item[]; docs: Doc[]; ensureGoal: (t: Track) => Promise<string>; addItems: (g: Gap[]) => Promise<void>;
  onChanged: () => Promise<void>; onMsg: (m: string) => void; onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState({ category: "product", title: "" });
  const [tasks, setTasks] = useState<{ id: string; status: string; due_on: string | null }[]>([]);
  useEffect(() => {
    const ids = items.map((i) => i.task_id).filter(Boolean);
    if (ids.length) officeRest<typeof tasks>(`office_tasks?id=in.(${ids.join(",")})&select=id,status,due_on`).then(setTasks, () => setTasks([]));
    else setTasks([]);
  }, [items]);
  const open = items.filter((i) => (i.status === "todo" || i.status === "doing") && (!i.task_id || tasks.find((t) => t.id === i.task_id)?.status === "dropped"));
  const gaps = useMemo(() => {
    const have = new Set(items.map((i) => i.title.toLowerCase()));
    const seen = new Set<string>();
    return docs.flatMap((d) => d.content.gaps || []).filter((g) => (biz.relationship === "client" || (g.track || "sale") === track)).filter((g) => { const k = g.title.toLowerCase(); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  }, [docs, items, track, biz.relationship]);

  async function setStatus(i: Item, status: Item["status"]) {
    try { await officePatch("office_readiness_items", `id=eq.${i.id}`, { status }); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Could not update."); }
  }
  async function createTasks() {
    if (!open.length) return;
    setBusy(true);
    try {
      const goalId = await ensureGoal(track);
      for (const i of open) {
        const t = await officeInsert<{ id: string }>("office_tasks", {
          business_id: biz.id, goal_id: goalId, title: i.title.slice(0, 200), priority: i.category === "legal" || i.category === "product" ? 1 : 2,
          notes: [i.detail, `From the ${biz.name} ${TRACK_LABEL[track].toLowerCase()} checklist (Incubator).`].filter(Boolean).join("\n"), source: "ai",
        });
        await officePatch("office_readiness_items", `id=eq.${i.id}`, { task_id: t.id, status: i.status === "todo" ? "doing" : i.status });
      }
      onMsg(`Created ${open.length} task${open.length === 1 ? "" : "s"} under the goal “${TRACK_LABEL[track]}: ${biz.name}”. They show on Tasks and in your daily plan; finishing one ticks it off here.`);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not create tasks."); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className={styles.toolbar} style={{ marginTop: 0 }}>
        <p className={styles.muted} style={{ margin: 0, maxWidth: 720 }}>
          {track === "production"
            ? `Everything that has to be true for ${biz.name} to run live, reliably and supported.`
            : `Everything that has to be true before ${biz.name} can be licensed or sold.`} Mark items that don't apply as N/A. Open items become tasks; finishing a task ticks the item off.
        </p>
        <button className="button button-primary" disabled={busy || !open.length} onClick={() => void createTasks()}>{busy ? "Creating…" : open.length ? `Turn ${open.length} open item${open.length === 1 ? "" : "s"} into tasks` : "Every open item has a task"}</button>
      </div>
      {gaps.length > 0 && (
        <article className={`${styles.card} ${styles.addForm}`}>
          <div className={styles.cardHead}><h2>Suggested by AI</h2><button type="button" className="button button-secondary" onClick={() => void addItems(gaps)}>Add all {gaps.length}</button></div>
          <ul className={styles.plainList}>
            {gaps.map((g) => (
              <li key={g.title} className={styles.reminderRow}>
                <div><strong>{g.title}</strong><small className={styles.muted}>{catLabel(g.category)} · {g.detail}</small></div>
                <button type="button" className={styles.linkButton} onClick={() => void addItems([g])}>Add</button>
              </li>
            ))}
          </ul>
        </article>
      )}
      <div className={styles.readinessGrid}>
        {CATEGORIES.map(([cat, label]) => {
          const list = items.filter((i) => i.category === cat);
          if (!list.length) return null;
          const c = readiness(list);
          return (
            <article key={cat} className={styles.card}>
              <div className={styles.cardHead}><h2>{label}</h2><small className={styles.muted}>{c.done}/{c.total}</small></div>
              <ul className={styles.plainList}>
                {list.map((i) => {
                  const t = tasks.find((x) => x.id === i.task_id);
                  return (
                    <li key={i.id} className={`${styles.readinessItem} ${i.status === "done" || i.status === "na" ? styles.taskDone : ""}`}>
                      <div>
                        <strong>{i.title}</strong>
                        {i.detail && <small className={styles.muted}>{i.detail}</small>}
                        {t && <small className={styles.muted}>Task {t.status === "done" ? "done" : t.status === "dropped" ? "dropped" : `open${t.due_on ? `, due ${prettyDate(t.due_on)}` : ""}`} · <a className={styles.smallLink} href="/office/tasks">Tasks →</a></small>}
                        {i.source === "ai" && <small className={styles.muted}>Suggested by AI</small>}
                      </div>
                      <select value={i.status} onChange={(e) => void setStatus(i, e.target.value as Item["status"])} aria-label={`${i.title} status`} className={styles[`rs_${i.status}`]}>
                        <option value="todo">To do</option><option value="doing">In progress</option><option value="done">Done</option><option value="na">N/A</option>
                      </select>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
      <form className={`${styles.card} ${styles.addForm}`} style={{ marginTop: 16 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!adding.title.trim()) return;
        try { await officeInsert("office_readiness_items", { business_id: biz.id, track, category: adding.category, title: adding.title.trim(), source: "manual", sort_order: 200 }); setAdding({ ...adding, title: "" }); await onChanged(); }
        catch (err) { onError(err instanceof Error ? err.message : "Could not add."); }
      }}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Category<select value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className={`${styles.field} ${styles.span2}`}>Add your own item<input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder={track === "production" ? "e.g. Import the 2025 listings" : "e.g. Letter of support from the NC cemetery association"} /></label>
          <div style={{ alignSelf: "end" }}><button className="button button-secondary" type="submit">Add</button></div>
        </div>
        <button type="button" className={styles.linkButton} style={{ justifySelf: "start" }} onClick={async () => {
          try { const n = await officeRpc<number>(track === "production" ? "office_seed_production" : "office_seed_readiness", { p_business: biz.id }); onMsg(n ? `Added ${n} standard items.` : "All standard items are already on the list."); await onChanged(); }
          catch (e) { onError(e instanceof Error ? e.message : "Could not restore."); }
        }}>Restore any deleted standard items</button>
      </form>
    </>
  );
}

function DocEditor({ biz, kind, docs, items, addItems, onChanged, onMsg, onError }: {
  biz: Business; kind: DocKind; docs: Doc[]; items: Item[]; addItems: (g: Gap[]) => Promise<void>; onChanged: () => Promise<void>; onMsg: (m: string) => void; onError: (m: string) => void;
}) {
  const [version, setVersion] = useState<number | null>(docs[0]?.version ?? null);
  const doc = docs.find((d) => d.version === version) || docs[0] || null;
  const outline = DOC_SECTIONS[kind];
  const blank = () => outline.map((o) => ({ key: o.key, title: o.title, body: "" }));
  const [sections, setSections] = useState(doc ? doc.content.sections : blank());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  useEffect(() => {
    setSections(doc ? outline.map((o) => doc.content.sections.find((s) => s.key === o.key) || { key: o.key, title: o.title, body: "" }) : blank());
    setDirty(false);
    setReview(null);
    if (doc) officeRest<Review[]>(`office_venture_reviews?doc_id=eq.${doc.id}&select=id,doc_id,created_at,model,review&order=created_at.desc&limit=1`).then((r) => setReview(r[0] ?? null), () => setReview(null));
  }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (dirty && !window.confirm("Drafting makes a new version; unsaved edits on this one will be lost. Continue?")) return;
    setBusy("ai");
    onMsg("");
    try {
      const r = await api<{ doc: Doc }>("/api/office/incubator/draft", { method: "POST", body: JSON.stringify({ business_id: biz.id, kind }) });
      setVersion(r.doc.version);
      onMsg(`Drafted ${DOC_LABEL[kind].toLowerCase()} v${r.doc.version}. Next: Review with AI for a critique, then approve.`);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not draft."); }
    finally { setBusy(""); }
  }
  async function save(asNew: boolean): Promise<number | null> {
    setBusy("save");
    try {
      if (!doc || asNew) {
        const v = (docs[0]?.version || 0) + 1;
        await officeInsert("office_venture_docs", { business_id: biz.id, kind, version: v, content: { sections, gaps: doc?.content.gaps || [] }, status: "draft", source: "manual" });
        setVersion(v);
        setDirty(false);
        await onChanged();
        return v;
      }
      await officePatch("office_venture_docs", `id=eq.${doc.id}`, { content: { ...doc.content, sections } });
      setDirty(false);
      await onChanged();
      return doc.version;
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save."); return null; }
    finally { setBusy(""); }
  }
  async function runReview() {
    if (!doc) return onError("Draft or write the document first.");
    if (dirty && (await save(doc.status === "approved")) === null) return;
    setBusy("review");
    onMsg("");
    try {
      const target = docs.find((d) => d.version === version) || doc;
      const r = await api<{ review: Review }>("/api/office/incubator/review", { method: "POST", body: JSON.stringify({ doc_id: target.id }) });
      setReview(r.review);
      onMsg(`Reviewed: ${r.review.review.score}/10. Suggestions are shown under each section; apply the ones you agree with.`);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not review."); }
    finally { setBusy(""); }
  }
  async function approve() {
    if (!doc) return;
    if (dirty && (await save(false)) === null) return;
    try {
      await officePatch("office_venture_docs", `id=eq.${doc.id}`, { status: "approved", approved_at: new Date().toISOString() });
      const key = kind === "business_plan" ? "business_plan" : kind === "marketing_plan" ? "marketing_plan" : null;
      const item = key ? items.find((i) => i.template_key === key && i.status !== "done") : null;
      if (item) await officePatch("office_readiness_items", `id=eq.${item.id}`, { status: "done" });
      onMsg(`${DOC_LABEL[kind]} v${doc.version} approved${item ? " and ticked off the checklist" : ""}.`);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not approve."); }
  }
  function download() {
    const md = [`# ${biz.name}: ${DOC_LABEL[kind]}`, `Version ${doc?.version ?? 1} · ${doc?.status ?? "draft"} · AI Real Solutions LLC`, "", ...sections.flatMap((s) => [`## ${s.title}`, "", s.body || "_To write._", ""])].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    a.download = `${biz.slug}-${kind.replace("_", "-")}-v${doc?.version ?? 1}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const applySuggestion = (key: string, text: string) => { setSections(sections.map((s) => (s.key === key ? { ...s, body: text } : s))); setDirty(true); };
  const applyAll = () => {
    if (!review) return;
    setSections(sections.map((s) => { const r = review.review.sections.find((x) => x.key === s.key); return r?.suggestion ? { ...s, body: r.suggestion } : s; }));
    setDirty(true);
    onMsg("All suggestions applied. Read them over, then save (approved documents save as a new draft).");
  };
  const rv = review?.review;
  const scoreClass = (n: number) => (n >= 8 ? styles.scoreGood : n >= 6 ? styles.scoreOk : styles.scoreLow);

  return (
    <article className={`${styles.card} ${styles.report}`}>
      <div className={styles.cardHead}>
        <div>
          <h2>{DOC_LABEL[kind]}</h2>
          <small className={styles.muted}>{doc ? `Version ${doc.version} · ${doc.status === "approved" ? `approved ${prettyDate(doc.approved_at?.slice(0, 10) || null)}` : "draft"} · ${doc.source === "ai" ? "drafted by AI" : "written by you"}` : "Not written yet. Draft it with AI or write it below."}</small>
        </div>
        <div className={styles.rowActions}>
          {docs.length > 1 && (
            <select value={doc?.version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Version" className={styles.cellSelect} style={{ minWidth: 0, width: "auto" }}>
              {docs.map((d) => <option key={d.id} value={d.version}>v{d.version} {d.status === "approved" ? "✓" : ""}</option>)}
            </select>
          )}
          <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void generate()}>{busy === "ai" ? "Writing… (about a minute)" : doc ? "Redraft with AI" : "Draft with AI"}</button>
          {doc && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void runReview()}>{busy === "review" ? "Reviewing… (a minute or two)" : rv ? "Review again" : "Review with AI"}</button>}
        </div>
      </div>
      {kind === "license_offer" && <small className={styles.muted}>License terms here are an outline to discuss, not legal advice; have an attorney prepare the actual agreement.</small>}

      {rv && (
        <div className={styles.reviewBox}>
          <div className={styles.cardHead}>
            <div className={styles.taskMeta}>
              <span className={`${styles.scoreBadge} ${scoreClass(rv.score)}`}>{rv.score}/10</span>
              <strong>AI review</strong>
              <small className={styles.muted}>{prettyDateTime(review!.created_at)}</small>
            </div>
            {rv.sections.some((s) => s.suggestion) && <button type="button" className="button button-secondary" onClick={applyAll}>Apply all suggestions</button>}
          </div>
          <p className={styles.brief}>{rv.verdict}</p>
          <div className={styles.formGrid}>
            <div><strong>Strengths</strong><ul className={styles.list}>{rv.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            <div><strong>Weaknesses</strong><ul className={styles.list}>{rv.weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            {rv.missing.length > 0 && <div><strong>Missing</strong><ul className={styles.list}>{rv.missing.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
            {rv.questions.length > 0 && <div><strong>Questions to answer</strong><ul className={styles.list}>{rv.questions.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
          </div>
          {rv.readiness.length > 0 && (
            <div className={styles.proposal}>
              <div className={styles.cardHead}><strong>Add to the readiness checklists</strong><button type="button" className={styles.linkButton} onClick={() => void addItems(rv.readiness)}>Add all</button></div>
              {rv.readiness.map((g) => (
                <div key={g.title} className={styles.reminderRow}>
                  <span><strong>{g.title}</strong> <small className={styles.muted}>{biz.relationship === "client" ? "" : `${TRACK_LABEL[g.track]} · `}{catLabel(g.category)}{g.detail ? ` · ${g.detail}` : ""}</small></span>
                  <button type="button" className={styles.linkButton} onClick={() => void addItems([g])}>Add</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sections.map((s, idx) => {
        const o = outline.find((x) => x.key === s.key);
        const r = rv?.sections.find((x) => x.key === s.key);
        return (
          <div key={s.key} className={styles.docSection}>
            <label className={styles.field}>
              <span className={styles.taskMeta}>{s.title}{r && <span className={`${styles.scoreBadge} ${scoreClass(r.score)}`}>{r.score}/10</span>}</span>
              {o && <small className={styles.muted} style={{ fontWeight: 400 }}>{o.guide}</small>}
              <textarea rows={Math.min(18, Math.max(4, Math.ceil((s.body || "").length / 90) + (s.body || "").split("\n").length))} value={s.body}
                onChange={(e) => { const next = [...sections]; next[idx] = { ...s, body: e.target.value }; setSections(next); setDirty(true); }} />
            </label>
            {r && (r.critique || (r.suggestion && r.suggestion !== s.body)) && (
              <div className={styles.critique}>
                {r.critique && <p><strong>Critique:</strong> {r.critique}</p>}
                {r.suggestion && r.suggestion !== s.body && (
                  <details>
                    <summary>Suggested rewrite</summary>
                    <p className={styles.timelineBody}>{r.suggestion}</p>
                    <button type="button" className="button button-secondary" onClick={() => applySuggestion(s.key, r.suggestion)}>Use this text</button>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className={styles.rowEnd}>
        <button type="button" className={styles.linkButton} onClick={download}>Download (.md)</button>
        <button type="button" className={styles.linkButton} onClick={() => window.print()}>Print</button>
        {doc?.status === "approved"
          ? <button type="button" className="button button-secondary" disabled={!dirty || !!busy} onClick={() => void save(true)}>Save as new draft</button>
          : <button type="button" className="button button-secondary" disabled={!dirty || !!busy} onClick={() => void save(false)}>{busy === "save" ? "Saving…" : "Save"}</button>}
        {doc && doc.status !== "approved" && <button type="button" className="button button-primary" disabled={!!busy} onClick={() => void approve()}>Approve</button>}
      </div>
    </article>
  );
}

const STARTERS = [
  "What are the three biggest things standing between this and production?",
  "Critique the business plan like an investor would.",
  "What should I get done this week?",
  "Is the pricing right? What would you change?",
  "Who are the first five customers I should talk to, and what do I say?",
];

function Advisor({ biz, ensureGoal, addItems, onError }: { biz: Business; ensureGoal: (t: Track) => Promise<string>; addItems: (g: Gap[]) => Promise<void>; onError: (m: string) => void }) {
  const [chat, setChat] = useState<Chat[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const load = useCallback(async () => {
    try { setChat(await officeRest<Chat[]>(`office_venture_chats?business_id=eq.${biz.id}&select=id,role,content,actions,created_at&order=created_at.asc&limit=200`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load the conversation."); }
  }, [biz.id, onError]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [chat.length, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text) return;
    setBusy(true);
    setQ("");
    setChat((c) => [...c, { id: `tmp${Date.now()}`, role: "user", content: text, actions: [], created_at: new Date().toISOString() }]);
    try {
      await api("/api/office/incubator/ask", { method: "POST", body: JSON.stringify({ business_id: biz.id, question: text }) });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : "The advisor could not answer.");
      setQ(text);
      await load();
    } finally { setBusy(false); }
  }
  async function act(msgId: string, a: Chat["actions"][number]) {
    try {
      if (a.type === "checklist") await addItems([a]);
      else {
        const goalId = await ensureGoal(biz.relationship === "client" ? "production" : a.track);
        await officeInsert("office_tasks", { business_id: biz.id, goal_id: goalId, title: a.title, notes: [a.detail, "Suggested by the Incubator advisor."].filter(Boolean).join("\n"), source: "ai", priority: 2 });
      }
      setDone((s) => new Set(s).add(`${msgId}|${a.title}`));
    } catch (e) { onError(e instanceof Error ? e.message : "Could not add it."); }
  }

  return (
    <article className={`${styles.card} ${styles.advisor}`}>
      <div className={styles.cardHead}>
        <div><h2>Advisor</h2><small className={styles.muted}>Knows {biz.name}&apos;s plans, checklists, goals, tasks, notes, deals and numbers. Ask anything; it suggests next steps you can add with one click.</small></div>
      </div>
      <div className={styles.chatLog}>
        {chat.length === 0 && !busy && (
          <div className={styles.starters}>
            {STARTERS.map((s) => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={m.role === "user" ? styles.msgUser : styles.msgAdvisor}>
            <p className={styles.timelineBody}>{m.content}</p>
            {m.role === "assistant" && m.actions?.length > 0 && (
              <div className={styles.msgActions}>
                {m.actions.map((a) => {
                  const k = `${m.id}|${a.title}`;
                  return (
                    <button key={k} type="button" disabled={done.has(k)} onClick={() => void act(m.id, a)}>
                      {done.has(k) ? "✓ Added" : a.type === "task" ? "+ Task" : "+ Checklist"}: {a.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
        {busy && <div className={styles.msgAdvisor}><p className={styles.muted}>Thinking…</p></div>}
        <div ref={end} />
      </div>
      <form className={styles.chatInput} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <label className={styles.field} style={{ flex: 1 }}>
          <span className={styles.srOnly}>Ask the advisor</span>
          <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Ask about ${biz.name}…`} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }} />
        </label>
        <button className="button button-primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </article>
  );
}

function Licensing({ biz, venture, onSaved, onError }: { biz: Business; venture: Venture; onSaved: (v: Venture) => void; onError: (m: string) => void }) {
  const [models, setModels] = useState<string[]>(venture.sale_models);
  const [price, setPrice] = useState(venture.asking_price_cents ? String(venture.asking_price_cents / 100) : "");
  const [summary, setSummary] = useState(venture.license_summary || "");
  const [saved, setSaved] = useState(false);
  async function save() {
    try {
      const change = { sale_models: models, asking_price_cents: price.trim() ? toCents(price) : null, license_summary: summary.trim() || null };
      await officePatch("office_ventures", `business_id=eq.${biz.id}`, change);
      onSaved({ ...venture, ...change });
      setSaved(true);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save."); }
  }
  return (
    <article className={`${styles.card} ${styles.addForm}`}>
      <h2>How {biz.name} can be bought</h2>
      <div className={styles.modelGrid}>
        {SALE_MODELS.map(([k, l, d]) => (
          <label key={k} className={`${styles.modelOption} ${models.includes(k) ? styles.modelOn : ""}`}>
            <input type="checkbox" checked={models.includes(k)} onChange={(e) => { setModels(e.target.checked ? [...models, k] : models.filter((m) => m !== k)); setSaved(false); }} />
            <span><strong>{l}</strong><small className={styles.muted}>{d}</small></span>
          </label>
        ))}
      </div>
      <div className={styles.formGrid4}>
        <label className={styles.field}>Asking price for outright sale ($)<input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setSaved(false); }} placeholder="Leave blank until valued" /></label>
        <label className={styles.field} style={{ gridColumn: "span 3" }}>One-line offer<input value={summary} onChange={(e) => { setSummary(e.target.value); setSaved(false); }} placeholder="White-label cemetery mapping for county governments, from $X/year" /></label>
      </div>
      <div className={styles.rowEnd}>
        <small className={styles.muted}>Put license tiers in <a className={styles.smallLink} href="/office/billing">Invoicing & Billing → Products</a> once priced.</small>
        {saved && <small className={styles.muted}>Saved</small>}
        <button type="button" className="button button-primary" onClick={() => void save()}>Save</button>
      </div>
    </article>
  );
}
