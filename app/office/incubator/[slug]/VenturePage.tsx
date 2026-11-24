"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../../office.module.css";
import { ErrorBox } from "../../components";
import { api } from "../../../factory/connections/session";
import { officeInsert, officePatch, officeRest, officeRpc, officeToday, prettyDate, type Business } from "../../lib/client";
import { DOC_LABEL, DOC_SECTIONS, type DocKind } from "../../../lib/office/venture-docs";
import { CATEGORIES, readiness, SALE_MODELS, STAGES, type Doc, type Item, type Venture } from "../types";

type Tab = "readiness" | DocKind;
const ITEM_SELECT = "id,business_id,category,title,detail,template_key,status,task_id,source,sort_order";
const toCents = (v: string) => { const n = Number(String(v).replace(/[$,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const quarterEnd = (d: string) => { const y = Number(d.slice(0, 4)), q = Math.floor((Number(d.slice(5, 7)) - 1) / 3); return new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10); };

export default function VenturePage({ slug }: { slug: string }) {
  const [biz, setBiz] = useState<Business | null>(null);
  const [venture, setVenture] = useState<Venture | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [tab, setTab] = useState<Tab>("readiness");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    try {
      const b = (await officeRest<Business[]>(`office_businesses?slug=eq.${encodeURIComponent(slug)}&select=id,entity_id,name,slug,relationship,category,status,website,summary,weekly_focus,factory_project_id,sort_order&limit=1`))[0];
      if (!b) { setError("Product not found."); return; }
      const [v, i, d] = await Promise.all([
        officeRest<Venture[]>(`office_ventures?business_id=eq.${b.id}&select=business_id,stage,sale_models,asking_price_cents,license_summary,goal_id,notes`),
        officeRest<Item[]>(`office_readiness_items?business_id=eq.${b.id}&select=${ITEM_SELECT}&order=sort_order.asc,created_at.asc`),
        officeRest<Doc[]>(`office_venture_docs?business_id=eq.${b.id}&select=*&order=version.desc`),
      ]);
      setBiz(b); setItems(i); setDocs(d);
      if (v[0]) setVenture(v[0]);
      else setVenture(await officeInsert<Venture>("office_ventures", { business_id: b.id, stage: "idea" }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load."); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  /** Make sure the "Ready to sell" goal exists and shows the current count. */
  const ensureGoal = useCallback(async (): Promise<string> => {
    if (!biz || !venture) throw new Error("Not loaded.");
    const r = readiness(items);
    if (venture.goal_id) return venture.goal_id;
    const g = await officeInsert<{ id: string }>("office_goals", { business_id: biz.id, level: "quarter", title: `Ready to sell ${biz.name}`, due_on: quarterEnd(officeToday()), target_value: r.total, current_value: r.done, unit: "items" });
    await officePatch("office_ventures", `business_id=eq.${biz.id}`, { goal_id: g.id });
    setVenture({ ...venture, goal_id: g.id });
    return g.id;
  }, [biz, venture, items]);

  if (!biz || !venture) return <section className={styles.page}><ErrorBox message={error} />{!error && <p className={styles.muted}>Loading…</p>}</section>;
  const r = readiness(items);

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <a className={styles.smallLink} href="/office/incubator">← Incubator</a>
      <header className={`${styles.pageHeader} ${styles.headerRow}`} style={{ marginTop: 10 }}>
        <div>
          <span className="product-tag">Incubator · {STAGES.find(([k]) => k === venture.stage)?.[1]}</span>
          <h1>{biz.name}</h1>
          <div className={styles.progressRow} style={{ maxWidth: 460 }}>
            <div className={styles.progressBar} role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Sale readiness"><i style={{ width: `${r.pct}%` }} /></div>
            <small><strong>{r.pct}%</strong> ready to sell ({r.done} of {r.total})</small>
          </div>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.field}>Stage
            <select value={venture.stage} onChange={async (e) => { const stage = e.target.value as Venture["stage"]; await officePatch("office_ventures", `business_id=eq.${biz.id}`, { stage }); setVenture({ ...venture, stage }); }}>
              {STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
        </div>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}
      <div className={styles.tabs} role="tablist">
        {([["readiness", "Sale readiness"], ["business_plan", DOC_LABEL.business_plan], ["marketing_plan", DOC_LABEL.marketing_plan], ["license_offer", DOC_LABEL.license_offer]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === "readiness" && <Readiness biz={biz} items={items} docs={docs} ensureGoal={ensureGoal} onChanged={load} onMsg={setMsg} onError={setError} />}
      {tab === "license_offer" && <Licensing biz={biz} venture={venture} onSaved={(v) => setVenture(v)} onError={setError} />}
      {tab !== "readiness" && <DocEditor key={tab} biz={biz} kind={tab} docs={docs.filter((d) => d.kind === tab)} items={items} onChanged={load} onMsg={setMsg} onError={setError} />}
    </section>
  );
}

function Readiness({ biz, items, docs, ensureGoal, onChanged, onMsg, onError }: {
  biz: Business; items: Item[]; docs: Doc[]; ensureGoal: () => Promise<string>; onChanged: () => Promise<void>; onMsg: (m: string) => void; onError: (m: string) => void;
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

  // Gaps the AI found in the latest plans that aren't on the checklist yet.
  const gaps = useMemo(() => {
    const have = new Set(items.map((i) => i.title.toLowerCase()));
    const seen = new Set<string>();
    return docs.flatMap((d) => d.content.gaps || []).filter((g) => { const k = g.title.toLowerCase(); if (have.has(k) || seen.has(k)) return false; seen.add(k); return true; });
  }, [docs, items]);

  async function setStatus(i: Item, status: Item["status"]) {
    try { await officePatch("office_readiness_items", `id=eq.${i.id}`, { status }); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Could not update."); }
  }
  async function createTasks() {
    if (!open.length) return;
    setBusy(true);
    try {
      const goalId = await ensureGoal();
      for (const i of open) {
        const t = await officeInsert<{ id: string }>("office_tasks", {
          business_id: biz.id, goal_id: goalId, title: i.title.slice(0, 200), priority: i.category === "legal" || i.category === "product" ? 1 : 2,
          notes: [i.detail, `From the ${biz.name} sale-readiness checklist (Incubator).`].filter(Boolean).join("\n"), source: "ai",
        });
        await officePatch("office_readiness_items", `id=eq.${i.id}`, { task_id: t.id, status: i.status === "todo" ? "doing" : i.status });
      }
      onMsg(`Created ${open.length} task${open.length === 1 ? "" : "s"} under the goal “Ready to sell ${biz.name}”. They show on Tasks and in your daily plan; finishing one ticks it off here.`);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not create tasks."); }
    finally { setBusy(false); }
  }
  async function addItem(category: string, title: string, detail: string | null, source: "manual" | "ai") {
    try { await officeInsert("office_readiness_items", { business_id: biz.id, category, title: title.trim(), detail, source, sort_order: 200 }); await onChanged(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not add."); }
  }

  return (
    <>
      <div className={styles.toolbar} style={{ marginTop: 0 }}>
        <p className={styles.muted} style={{ margin: 0, maxWidth: 720 }}>Everything that has to be true before {biz.name} can be licensed or sold. Mark items that don't apply as N/A. Open items become tasks; finishing a task ticks the item off.</p>
        <button className="button button-primary" disabled={busy || !open.length} onClick={() => void createTasks()}>{busy ? "Creating…" : open.length ? `Turn ${open.length} open item${open.length === 1 ? "" : "s"} into tasks` : "Every open item has a task"}</button>
      </div>

      {gaps.length > 0 && (
        <article className={`${styles.card} ${styles.addForm}`}>
          <h2>Gaps the AI found in your plans</h2>
          <ul className={styles.plainList}>
            {gaps.map((g) => (
              <li key={g.title} className={styles.reminderRow}>
                <div><strong>{g.title}</strong><small className={styles.muted}>{CATEGORIES.find(([k]) => k === g.category)?.[1]} · {g.detail}</small></div>
                <button type="button" className={styles.linkButton} onClick={() => void addItem(g.category, g.title, g.detail || null, "ai")}>Add to checklist</button>
              </li>
            ))}
          </ul>
        </article>
      )}

      <div className={styles.readinessGrid}>
        {CATEGORIES.map(([cat, label]) => {
          const list = items.filter((i) => i.category === cat);
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
                        {i.source === "ai" && <small className={styles.muted}>Added from an AI gap check</small>}
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

      <form className={`${styles.card} ${styles.addForm}`} style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); if (adding.title.trim()) { void addItem(adding.category, adding.title, null, "manual"); setAdding({ ...adding, title: "" }); } }}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Category<select value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })}>{CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className={`${styles.field} ${styles.span2}`}>Add your own item<input value={adding.title} onChange={(e) => setAdding({ ...adding, title: e.target.value })} placeholder="e.g. Get a letter of support from the NC cemetery association" /></label>
          <div style={{ alignSelf: "end" }}><button className="button button-secondary" type="submit">Add</button></div>
        </div>
        <button type="button" className={styles.linkButton} style={{ justifySelf: "start" }} onClick={async () => { try { const n = await officeRpc<number>("office_seed_readiness", { p_business: biz.id }); onMsg(n ? `Added ${n} standard items.` : "All standard items are already on the list."); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Could not restore."); } }}>Restore any deleted standard items</button>
      </form>
    </>
  );
}

function DocEditor({ biz, kind, docs, items, onChanged, onMsg, onError }: {
  biz: Business; kind: DocKind; docs: Doc[]; items: Item[]; onChanged: () => Promise<void>; onMsg: (m: string) => void; onError: (m: string) => void;
}) {
  const [version, setVersion] = useState<number | null>(docs[0]?.version ?? null);
  const doc = docs.find((d) => d.version === version) || docs[0] || null;
  const outline = DOC_SECTIONS[kind];
  const blank = () => outline.map((o) => ({ key: o.key, title: o.title, body: "" }));
  const [sections, setSections] = useState(doc ? doc.content.sections : blank());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  useEffect(() => { setSections(doc ? outline.map((o) => doc.content.sections.find((s) => s.key === o.key) || { key: o.key, title: o.title, body: "" }) : blank()); setDirty(false); }, [doc?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    if (dirty && !window.confirm("Generating makes a new draft version; unsaved edits on this one will be lost. Continue?")) return;
    setBusy("ai");
    onMsg("");
    try {
      const r = await api<{ doc: Doc }>("/api/office/incubator/draft", { method: "POST", body: JSON.stringify({ business_id: biz.id, kind }) });
      setVersion(r.doc.version);
      onMsg(`Drafted ${DOC_LABEL[kind].toLowerCase()} v${r.doc.version}.${r.doc.content.gaps?.length ? ` The AI also found ${r.doc.content.gaps.length} gap${r.doc.content.gaps.length === 1 ? "" : "s"}; see Sale readiness.` : ""} Review and edit, then approve.`);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not draft."); }
    finally { setBusy(""); }
  }
  async function save(asNew: boolean) {
    setBusy("save");
    try {
      if (!doc || asNew) {
        const v = (docs[0]?.version || 0) + 1;
        await officeInsert("office_venture_docs", { business_id: biz.id, kind, version: v, content: { sections, gaps: doc?.content.gaps || [] }, status: "draft", source: "manual" });
        setVersion(v);
      } else {
        await officePatch("office_venture_docs", `id=eq.${doc.id}`, { content: { ...doc.content, sections } });
      }
      setDirty(false);
      await onChanged();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save."); }
    finally { setBusy(""); }
  }
  async function approve() {
    if (!doc) return;
    if (dirty) await save(false);
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

  return (
    <article className={`${styles.card} ${styles.report}`}>
      <div className={styles.cardHead}>
        <div>
          <h2>{DOC_LABEL[kind]}</h2>
          <small className={styles.muted}>
            {doc ? `Version ${doc.version} · ${doc.status === "approved" ? `approved ${prettyDate(doc.approved_at?.slice(0, 10) || null)}` : "draft"} · ${doc.source === "ai" ? "drafted by AI" : "written by you"}` : "Not written yet."}
          </small>
        </div>
        <div className={styles.rowActions}>
          {docs.length > 1 && (
            <select value={doc?.version} onChange={(e) => setVersion(Number(e.target.value))} aria-label="Version" className={styles.cellSelect} style={{ minWidth: 0, width: "auto" }}>
              {docs.map((d) => <option key={d.id} value={d.version}>v{d.version} {d.status === "approved" ? "✓" : ""}</option>)}
            </select>
          )}
          <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void generate()}>{busy === "ai" ? "Writing… (about a minute)" : doc ? "Redraft with AI" : "Draft with AI"}</button>
        </div>
      </div>
      {kind === "license_offer" && <small className={styles.muted}>License terms here are an outline to discuss, not legal advice; have an attorney prepare the actual agreement.</small>}
      {sections.map((s, idx) => {
        const o = outline.find((x) => x.key === s.key);
        return (
          <label key={s.key} className={styles.field}>
            {s.title}
            {o && <small className={styles.muted} style={{ fontWeight: 400 }}>{o.guide}</small>}
            <textarea rows={Math.min(18, Math.max(4, Math.ceil((s.body || "").length / 90) + (s.body || "").split("\n").length))} value={s.body}
              onChange={(e) => { const next = [...sections]; next[idx] = { ...s, body: e.target.value }; setSections(next); setDirty(true); }} />
          </label>
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
        <label className={`${styles.field}`} style={{ gridColumn: "span 3" }}>One-line offer<input value={summary} onChange={(e) => { setSummary(e.target.value); setSaved(false); }} placeholder="White-label cemetery mapping for county governments, from $X/year" /></label>
      </div>
      <div className={styles.rowEnd}>
        <small className={styles.muted}>Put license tiers in <a className={styles.smallLink} href="/office/billing">Invoicing & Billing → Products</a> once priced.</small>
        {saved && <small className={styles.muted}>Saved</small>}
        <button type="button" className="button button-primary" onClick={() => void save()}>Save</button>
      </div>
    </article>
  );
}
