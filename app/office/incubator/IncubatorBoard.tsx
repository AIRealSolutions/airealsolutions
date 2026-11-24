"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeInsert, officeRest, officeRpc, type Business } from "../lib/client";
import { DOC_LABEL, docKindsFor } from "../../lib/office/venture-docs";
import { ITEM_SELECT, readiness, SALE_MODELS, STAGES, VENTURE_SELECT, type Doc, type Item, type Track, type Venture } from "./types";

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);

export function Meter({ label, items, track, compact }: { label: string; items: Item[]; track: Track; compact?: boolean }) {
  const r = readiness(items, track);
  return (
    <div className={styles.meter}>
      <div className={styles.meterHead}><span>{label}</span><strong>{r.pct}%</strong></div>
      <div className={`${styles.progressBar} ${track === "sale" ? styles.barSale : ""}`} role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i style={{ width: `${r.pct}%` }} /></div>
      {!compact && <small className={styles.muted}>{r.done} of {r.total} done</small>}
    </div>
  );
}

export default function IncubatorBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Pick<Doc, "business_id" | "kind" | "status">[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [v, i, d] = await Promise.all([
        officeRest<Venture[]>(`office_ventures?select=${VENTURE_SELECT}`),
        officeRest<Item[]>(`office_readiness_items?select=${ITEM_SELECT}&limit=5000`),
        officeRest<Pick<Doc, "business_id" | "kind" | "status">[]>("office_venture_docs?select=business_id,kind,status"),
      ]);
      setVentures(v); setItems(i); setDocs(d);
    } catch (e) {
      const m = e instanceof Error ? e.message : "Could not load the Incubator.";
      setError(/production_goal_id|track/.test(m) ? "Run docs/office-readiness.sql in Supabase to add production readiness." : /not in the database/i.test(m) ? "The Incubator isn't set up yet. Run docs/office-incubator.sql, then docs/office-readiness.sql, in Supabase." : m);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // New businesses (e.g. a client added on Businesses) join the Incubator with their checklists.
  const [enrolled, setEnrolled] = useState(false);
  useEffect(() => {
    if (enrolled || !businesses.length || !ventures.length) return;
    const missing = businesses.filter((b) => !ventures.some((v) => v.business_id === b.id));
    if (!missing.length) return;
    setEnrolled(true);
    void (async () => {
      try {
        for (const b of missing) {
          await officeInsert("office_ventures", { business_id: b.id, stage: b.status === "parked" ? "paused" : "idea" });
          await officeRpc("office_seed_production", { p_business: b.id });
          if (b.relationship !== "client") await officeRpc("office_seed_readiness", { p_business: b.id });
        }
        await load();
      } catch (e) { setError(e instanceof Error ? e.message : "Could not add new businesses."); }
    })();
  }, [businesses, ventures, enrolled, load]);

  const rows = (rel: (b: Business) => boolean) => ventures
    .map((v) => ({ v, b: businesses.find((x) => x.id === v.business_id), its: items.filter((i) => i.business_id === v.business_id) }))
    .filter((r): r is { v: Venture; b: Business; its: Item[] } => Boolean(r.b && rel(r.b)))
    .sort((a, z) => (a.v.stage === "paused" ? 1 : 0) - (z.v.stage === "paused" ? 1 : 0) || readiness(z.its, "production").pct - readiness(a.its, "production").pct);
  const owned = rows((b) => b.relationship !== "client");
  const clients = rows((b) => b.relationship === "client");

  const card = ({ v, b, its }: { v: Venture; b: Business; its: Item[] }) => {
    const docState = (kind: Doc["kind"]) => {
      const d = docs.filter((x) => x.business_id === v.business_id && x.kind === kind);
      return d.some((x) => x.status === "approved") ? "approved" : d.length ? "draft" : "none";
    };
    return (
      <a key={v.business_id} href={`/office/incubator/${b.slug}`} className={`${styles.card} ${styles.ventureCard} ${v.stage === "paused" ? styles.taskDone : ""}`}>
        <div className={styles.cardHead}>
          <div>
            <h2>{b.name}</h2>
            <small className={styles.muted}>{b.category || (b.relationship === "parent" ? "The Factory & services" : "Product")}</small>
          </div>
          <span className={`${styles.statusPill} ${["live", "licensed", "sold", "for_sale"].includes(v.stage) ? styles.st_paid : ""}`}>{STAGES.find(([k]) => k === v.stage)?.[1]}</span>
        </div>
        <Meter label="Ready for production" items={its} track="production" />
        {b.relationship !== "client" && <Meter label="Ready to sell" items={its} track="sale" />}
        <div className={styles.taskMeta}>
          {docKindsFor(b.relationship).map((k) => {
            const s = docState(k);
            return <small key={k} className={s === "approved" ? styles.docOk : s === "draft" ? styles.docDraft : styles.muted}>{s === "approved" ? "✓" : s === "draft" ? "◐" : "○"} {DOC_LABEL[k]}</small>;
          })}
        </div>
        {b.relationship !== "client" && (v.sale_models.length > 0 || v.asking_price_cents) && (
          <small className={styles.muted}>{v.sale_models.map((m) => SALE_MODELS.find(([k]) => k === m)?.[1]).join(" · ")}{v.asking_price_cents ? ` · asking ${money(v.asking_price_cents)}` : ""}</small>
        )}
      </a>
    );
  };

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">AI Real Solutions LLC · Incubator</span>
        <h1>Incubator</h1>
        <p>Every business on its way to production: the products the LLC owns (and will license or sell) and the clients it builds for. Plans are drafted and critiqued by AI; whatever is still missing becomes a task.</p>
      </header>
      <ErrorBox message={bizError || error} />
      <h2 className={styles.sectionTitle}>Owned by AI Real Solutions <small>({owned.length})</small></h2>
      <div className={styles.ventureGrid}>{owned.map(card)}</div>
      <h2 className={styles.sectionTitle}>Clients we build for <small>({clients.length})</small></h2>
      {clients.length === 0 && !error && <p className={styles.muted}>No clients yet. Add one on Businesses; it appears here with its production checklist.</p>}
      <div className={styles.ventureGrid}>{clients.map(card)}</div>
    </section>
  );
}
