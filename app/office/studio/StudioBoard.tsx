"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { api } from "../../factory/connections/session";
import { officeInsert, officePatch, officeRest, officeToday, shiftDate, type Business } from "../lib/client";
import {
  ASSET_SELECT, CHANNELS, CONTENT_SELECT, dayOf, FORMATS, formatIcon, formatLabel, STATUSES, timeOf, weekSlot,
  type Asset, type BrandKit, type Content, type Format,
} from "./types";

type Tab = "calendar" | "pipeline" | "ideas" | "brand";
type Idea = { title: string; format: Format; channels: string[]; angle: string; week: number; why: string };

export default function StudioBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [tab, setTab] = useState<Tab>("calendar");
  const [content, setContent] = useState<Content[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { try { const t = localStorage.getItem("office.studio.tab") as Tab | null; if (t) setTab(t); } catch { /* ignore */ } }, []);
  const choose = (t: Tab) => { setTab(t); setMsg(""); try { localStorage.setItem("office.studio.tab", t); } catch { /* ignore */ } };

  const load = useCallback(async () => {
    try { setContent(await officeRest<Content[]>(`office_content?status=neq.archived&select=${CONTENT_SELECT}&order=scheduled_at.asc.nullslast,created_at.desc&limit=1000`)); }
    catch (e) { setError(e instanceof Error && /not in the database/i.test(e.message) ? "The Content Studio isn't set up yet. Run docs/office-phase6.sql in Supabase." : e instanceof Error ? e.message : "Could not load content."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const shown = content.filter((c) => !filter || c.business_id === filter);

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">Grow</span>
          <h1>Content Studio</h1>
          <p>Posts, reels, Shorts, YouTube videos and emails for every business, from idea to published. AI suggests ideas from each marketing plan and the news, then writes them in the brand&apos;s voice.</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.toolbarField}><BusinessSelect businesses={businesses} value={filter} onChange={setFilter} noneLabel="All businesses" label="Business" /></div>
        </div>
      </header>
      <ErrorBox message={bizError || error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}
      <div className={styles.tabs} role="tablist">
        {([["calendar", "Calendar"], ["pipeline", "Pipeline"], ["ideas", "AI ideas"], ["brand", "Brand kits"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? styles.tabActive : undefined} onClick={() => choose(k)}>{l}</button>
        ))}
      </div>
      {(tab === "calendar" || tab === "pipeline") && <NewContent businesses={businesses} defaultBusiness={filter} onCreated={(id) => window.location.assign(`/office/studio/${id}`)} onError={setError} />}
      {tab === "calendar" && <Calendar items={shown} businesses={businesses} />}
      {tab === "pipeline" && <Pipeline items={shown} businesses={businesses} onChanged={load} onError={setError} />}
      {tab === "ideas" && <Ideas businesses={businesses} defaultBusiness={filter} onAdded={async (n) => { setMsg(`Added ${n} idea${n === 1 ? "" : "s"} to the calendar.`); await load(); }} onError={setError} />}
      {tab === "brand" && <BrandKits businesses={businesses} defaultBusiness={filter} onMsg={setMsg} onError={setError} />}
    </section>
  );
}

function NewContent({ businesses, defaultBusiness, onCreated, onError }: { businesses: Business[]; defaultBusiness: string; onCreated: (id: string) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ business: defaultBusiness, title: "", format: "reel" as Format, date: "" });
  useEffect(() => setF((v) => ({ ...v, business: defaultBusiness || v.business })), [defaultBusiness]);
  if (!open) return <div className={styles.rowEnd} style={{ marginBottom: 10 }}><button className="button button-primary" onClick={() => setOpen(true)}>+ New content</button></div>;
  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={async (e) => {
      e.preventDefault();
      if (!f.business || !f.title.trim()) return onError("Pick a business and give it a working title.");
      try {
        const c = await officeInsert<Content>("office_content", { business_id: f.business, title: f.title.trim(), format: f.format, status: "idea", scheduled_at: f.date ? new Date(f.date).toISOString() : null });
        onCreated(c.id);
      } catch (err) { onError(err instanceof Error ? err.message : "Could not create it."); }
    }}>
      <div className={styles.formGrid4}>
        <BusinessSelect businesses={businesses} value={f.business} onChange={(v) => setF({ ...f, business: v })} noneLabel="Choose…" />
        <label className={styles.field}>Working title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="3 things to know before…" required /></label>
        <label className={styles.field}>Format<select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as Format })}>{FORMATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className={styles.field}>Publish on (optional)<input type="datetime-local" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
      </div>
      <div className={styles.rowEnd}><button type="button" className={styles.linkButton} onClick={() => setOpen(false)}>Cancel</button><button className="button button-primary" type="submit">Create and open</button></div>
    </form>
  );
}

function Calendar({ items, businesses }: { items: Content[]; businesses: Business[] }) {
  const today = officeToday();
  const [month, setMonth] = useState(today.slice(0, 7));
  const days = useMemo(() => {
    const first = new Date(`${month}-01T12:00:00Z`);
    const start = shiftDate(`${month}-01`, -((first.getUTCDay() || 7) - 1));
    return Array.from({ length: 42 }, (_, i) => shiftDate(start, i));
  }, [month]);
  const byDay = useMemo(() => {
    const m = new Map<string, Content[]>();
    for (const c of items) if (c.scheduled_at) { const d = dayOf(c.scheduled_at); m.set(d, [...(m.get(d) || []), c]); }
    return m;
  }, [items]);
  const undated = items.filter((c) => !c.scheduled_at && c.status !== "published");
  const label = new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const move = (n: number) => { const d = new Date(`${month}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const chip = (c: Content) => (
    <a key={c.id} href={`/office/studio/${c.id}`} className={`${styles.calChip} ${styles[`cs_${c.status}`] || ""}`} title={`${formatLabel(c.format)} · ${STATUSES.find(([k]) => k === c.status)?.[1]}`}>
      <span>{formatIcon(c.format)}</span>
      <span className={styles.calChipText}>{c.scheduled_at ? `${timeOf(c.scheduled_at)} ` : ""}{c.title}</span>
      <BizTag business={businesses.find((b) => b.id === c.business_id)} />
    </a>
  );

  return (
    <div className={styles.studioCal}>
      <div>
        <div className={styles.toolbar} style={{ marginTop: 0 }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>{label}</h2>
          <div className={styles.headerActions}>
            <button className="button button-secondary" onClick={() => move(-1)} aria-label="Previous month">←</button>
            <button className="button button-secondary" onClick={() => setMonth(today.slice(0, 7))}>Today</button>
            <button className="button button-secondary" onClick={() => move(1)} aria-label="Next month">→</button>
          </div>
        </div>
        <div className={styles.monthGrid}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className={styles.monthHead}>{d}</div>)}
          {days.map((d) => (
            <div key={d} className={`${styles.monthDay} ${d.slice(0, 7) !== month ? styles.monthOther : ""} ${d === today ? styles.weekToday : ""}`}>
              <span className={styles.monthNum}>{Number(d.slice(8))}</span>
              {(byDay.get(d) || []).map(chip)}
            </div>
          ))}
        </div>
      </div>
      <aside className={`${styles.card} ${styles.undated}`}>
        <h2>No date yet <small className={styles.muted}>({undated.length})</small></h2>
        {undated.length === 0 && <p className={styles.muted}>Every piece has a date.</p>}
        <div className={styles.stack} style={{ gap: 6 }}>{undated.map(chip)}</div>
      </aside>
    </div>
  );
}

function Pipeline({ items, businesses, onChanged, onError }: { items: Content[]; businesses: Business[]; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const cols = STATUSES.filter(([k]) => k !== "archived");
  const move = async (c: Content, dir: -1 | 1) => {
    const i = cols.findIndex(([k]) => k === c.status);
    const next = cols[i + dir];
    if (!next) return;
    try { await officePatch("office_content", `id=eq.${c.id}`, { status: next[0] }); await onChanged(); } catch (e) { onError(e instanceof Error ? e.message : "Could not move it."); }
  };
  return (
    <div className={styles.kanban}>
      {cols.map(([k, label], ci) => {
        const col = items.filter((c) => c.status === k);
        return (
          <div key={k} className={styles.kanbanCol}>
            <div className={styles.kanbanHead}><strong>{label}</strong><small>{col.length}</small></div>
            {col.map((c) => (
              <article key={c.id} className={styles.dealCard}>
                <a href={`/office/studio/${c.id}`}><strong>{formatIcon(c.format)} {c.title}</strong></a>
                <span className={styles.taskMeta}><BizTag business={businesses.find((b) => b.id === c.business_id)} />{c.scheduled_at && <small className={styles.muted}>{dayOf(c.scheduled_at)}</small>}</span>
                {c.channels.length > 0 && <small className={styles.muted}>{c.channels.map((x) => CHANNELS.find(([v]) => v === x)?.[1]).join(" · ")}</small>}
                <div className={styles.dealMove}>
                  <button type="button" disabled={ci === 0} aria-label="Move back" onClick={() => void move(c, -1)}>←</button>
                  <button type="button" disabled={ci === cols.length - 1} aria-label="Move forward" onClick={() => void move(c, 1)}>→</button>
                </div>
              </article>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Ideas({ businesses, defaultBusiness, onAdded, onError }: { businesses: Business[]; defaultBusiness: string; onAdded: (n: number) => Promise<void>; onError: (m: string) => void }) {
  const [business, setBusiness] = useState(defaultBusiness);
  const [count, setCount] = useState(8);
  const [weeks, setWeeks] = useState(4);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState("");
  useEffect(() => { if (defaultBusiness) setBusiness(defaultBusiness); }, [defaultBusiness]);

  async function get() {
    if (!business) return onError("Pick a business.");
    setBusy("ideas");
    try {
      const r = await api<{ ideas: Idea[] }>("/api/office/studio/ideas", { method: "POST", body: JSON.stringify({ business_id: business, count, weeks }) });
      setIdeas(r.ideas);
      setPicked(new Set(r.ideas.map((_, i) => i)));
    } catch (e) { onError(e instanceof Error ? e.message : "Could not get ideas."); }
    finally { setBusy(""); }
  }
  async function add() {
    setBusy("add");
    try {
      const chosen = ideas.filter((_, i) => picked.has(i));
      const perWeek = new Map<number, number>();
      for (const i of chosen) {
        const n = perWeek.get(i.week) || 0;
        perWeek.set(i.week, n + 1);
        await officeInsert("office_content", {
          business_id: business, title: i.title, format: i.format, channels: i.channels, status: "idea", source: "ai",
          idea: [i.angle, i.why ? `Why: ${i.why}` : ""].filter(Boolean).join("\n\n"), scheduled_at: weekSlot(i.week, (n * 2) % 5),
        });
      }
      setIdeas([]);
      await onAdded(chosen.length);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not add them."); }
    finally { setBusy(""); }
  }

  return (
    <article className={`${styles.card} ${styles.addForm}`}>
      <h2>AI ideas</h2>
      <p className={styles.muted}>Ideas come from the business&apos;s brand kit, its marketing plan (approved, or the latest draft) and its top Feed items. You pick which go on the calendar; then open each to have AI write it.</p>
      <div className={styles.formGrid4}>
        <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} noneLabel="Choose…" />
        <label className={styles.field}>How many<input type="number" min={3} max={20} value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        <label className={styles.field}>Over (weeks)<input type="number" min={1} max={8} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} /></label>
        <div style={{ alignSelf: "end" }}><button className="button button-primary" disabled={!!busy || !business} onClick={() => void get()}>{busy === "ideas" ? "Thinking… (about a minute)" : "Get ideas"}</button></div>
      </div>
      {ideas.length > 0 && (
        <>
          <ul className={styles.plainList}>
            {ideas.map((i, idx) => (
              <li key={idx} className={styles.ideaRow}>
                <input type="checkbox" checked={picked.has(idx)} aria-label={`Include ${i.title}`} onChange={() => setPicked((s) => { const n = new Set(s); if (n.has(idx)) n.delete(idx); else n.add(idx); return n; })} />
                <div>
                  <strong>{formatIcon(i.format)} {i.title}</strong>
                  <small className={styles.muted}>{formatLabel(i.format)} · {i.channels.map((c) => CHANNELS.find(([v]) => v === c)?.[1]).join(", ")} · week {i.week + 1}</small>
                  <p>{i.angle}</p>
                  {i.why && <small className={styles.muted}>Why: {i.why}</small>}
                </div>
              </li>
            ))}
          </ul>
          <div className={styles.rowEnd}><button className="button button-primary" disabled={!!busy || picked.size === 0} onClick={() => void add()}>{busy === "add" ? "Adding…" : `Add ${picked.size} to the calendar`}</button></div>
        </>
      )}
    </article>
  );
}

function BrandKits({ businesses, defaultBusiness, onMsg, onError }: { businesses: Business[]; defaultBusiness: string; onMsg: (m: string) => void; onError: (m: string) => void }) {
  const [business, setBusiness] = useState(defaultBusiness || "");
  const [kit, setKit] = useState<BrandKit | null>(null);
  const [logos, setLogos] = useState<Asset[]>([]);
  const [f, setF] = useState({ tagline: "", voice: "", audience: "", colors: "", fonts: "", hashtags: "", disclaimers: "", do_dont: "", logo: "" });
  useEffect(() => { if (!business && businesses[0]) setBusiness(defaultBusiness || businesses[0].id); }, [businesses, business, defaultBusiness]);
  useEffect(() => {
    if (!business) return;
    Promise.all([
      officeRest<BrandKit[]>(`office_brand_kits?business_id=eq.${business}&select=*`),
      officeRest<Asset[]>(`office_assets?business_id=eq.${business}&kind=in.(logo,image)&select=${ASSET_SELECT}&order=created_at.desc&limit=50`),
    ]).then(([k, a]) => {
      const x = k[0] || null;
      setKit(x); setLogos(a);
      setF({ tagline: x?.tagline || "", voice: x?.voice || "", audience: x?.audience || "", colors: (x?.colors || []).join(", "), fonts: x?.fonts || "", hashtags: (x?.hashtags || []).join(" "), disclaimers: x?.disclaimers || "", do_dont: x?.do_dont || "", logo: x?.logo_asset_id || "" });
    }, (e) => onError(e instanceof Error ? e.message : "Could not load the brand kit."));
  }, [business, onError]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const colors = f.colors.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean).map((c) => (c.startsWith("#") ? c : `#${c}`).toUpperCase());
    if (colors.some((c) => !/^#[0-9A-F]{6}$/.test(c))) return onError("Colors are 6-digit hex codes like #1D4ED8.");
    const hashtags = f.hashtags.split(/[\s,]+/).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`));
    try {
      await officeRest("office_brand_kits?on_conflict=business_id", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ business_id: business, tagline: f.tagline.trim() || null, voice: f.voice.trim() || null, audience: f.audience.trim() || null, colors, fonts: f.fonts.trim() || null, hashtags, disclaimers: f.disclaimers.trim() || null, do_dont: f.do_dont.trim() || null, logo_asset_id: f.logo || null }),
      });
      // A brand kit with a voice and colors ticks the "Brand kit" item on the sale checklist.
      let ticked = false;
      if (f.voice.trim() && colors.length) {
        const item = (await officeRest<{ id: string; status: string }[]>(`office_readiness_items?business_id=eq.${business}&template_key=eq.brand&select=id,status`).catch(() => []))[0];
        if (item && item.status !== "done") { await officePatch("office_readiness_items", `id=eq.${item.id}`, { status: "done" }); ticked = true; }
      }
      onMsg(`Brand kit saved${ticked ? " and ticked off the sale-readiness checklist" : ""}. AI ideas and drafts for this business now use it.`);
    } catch (err) { onError(err instanceof Error ? err.message : "Could not save."); }
  }
  const swatches = f.colors.split(/[\s,]+/).filter((c) => /^#?[0-9a-f]{6}$/i.test(c)).map((c) => (c.startsWith("#") ? c : `#${c}`));

  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={save}>
      <div className={styles.formGrid4}>
        <div className={styles.span2}><BusinessSelect businesses={businesses} value={business} onChange={setBusiness} allowNone={false} /></div>
        <label className={`${styles.field} ${styles.span2}`}>Tagline<input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></label>
        <label className={`${styles.field} ${styles.span2}`}>Voice<textarea rows={3} value={f.voice} onChange={(e) => setF({ ...f, voice: e.target.value })} placeholder="Plain-spoken, practical, neighborly. Explain, don't sell." /></label>
        <label className={`${styles.field} ${styles.span2}`}>Audience<textarea rows={3} value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })} placeholder="County managers and church cemetery committees in NC" /></label>
        <label className={styles.field}>Colors (hex)<input value={f.colors} onChange={(e) => setF({ ...f, colors: e.target.value })} placeholder="#1D4ED8, #0F766E" /></label>
        <div className={styles.swatches} aria-hidden="true">{swatches.map((c) => <span key={c} style={{ background: c }} />)}</div>
        <label className={styles.field}>Fonts<input value={f.fonts} onChange={(e) => setF({ ...f, fonts: e.target.value })} /></label>
        <label className={styles.field}>Logo
          <select value={f.logo} onChange={(e) => setF({ ...f, logo: e.target.value })}>
            <option value="">{logos.length ? "None" : "Upload one in the Library"}</option>
            {logos.map((a) => <option key={a.id} value={a.id}>{a.file_name}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${styles.span2}`}>Hashtags<input value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} placeholder="#CemeteryMapping #NCGov" /></label>
        <label className={`${styles.field} ${styles.span2}`}>Required disclaimers<textarea rows={2} value={f.disclaimers} onChange={(e) => setF({ ...f, disclaimers: e.target.value })} /></label>
        <label className={`${styles.field}`} style={{ gridColumn: "1 / -1" }}>Do &amp; don&apos;t<textarea rows={2} value={f.do_dont} onChange={(e) => setF({ ...f, do_dont: e.target.value })} placeholder="Do show real screens. Don't promise savings figures." /></label>
      </div>
      <div className={styles.rowEnd}>{!kit && <small className={styles.muted}>No kit yet for this business.</small>}<button className="button button-primary" type="submit">Save brand kit</button></div>
    </form>
  );
}
