"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeRest } from "../lib/client";
import { DOC_LABEL, type DocKind } from "../../lib/office/venture-docs";
import { CATEGORIES, readiness, SALE_MODELS, STAGES, type Doc, type Item, type Venture } from "./types";

const money = (c: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);

export default function IncubatorBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [ventures, setVentures] = useState<Venture[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [docs, setDocs] = useState<Pick<Doc, "business_id" | "kind" | "status" | "version">[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const [v, i, d] = await Promise.all([
        officeRest<Venture[]>("office_ventures?select=business_id,stage,sale_models,asking_price_cents,license_summary,goal_id,notes"),
        officeRest<Item[]>("office_readiness_items?select=id,business_id,category,title,status,task_id,template_key,detail,source,sort_order&limit=2000"),
        officeRest<Pick<Doc, "business_id" | "kind" | "status" | "version">[]>("office_venture_docs?select=business_id,kind,status,version&order=version.desc"),
      ]);
      setVentures(v); setItems(i); setDocs(d);
    } catch (e) {
      setError(e instanceof Error && /not in the database/i.test(e.message) ? "The Incubator isn't set up yet. Run docs/office-incubator.sql in Supabase." : e instanceof Error ? e.message : "Could not load the Incubator.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const rows = ventures
    .map((v) => ({ v, b: businesses.find((x) => x.id === v.business_id), its: items.filter((i) => i.business_id === v.business_id) }))
    .filter((r) => r.b)
    .sort((a, z) => (a.v.stage === "paused" ? 1 : 0) - (z.v.stage === "paused" ? 1 : 0) || readiness(z.its).pct - readiness(a.its).pct);
  const docState = (bid: string, kind: DocKind) => {
    const d = docs.filter((x) => x.business_id === bid && x.kind === kind);
    return d.some((x) => x.status === "approved") ? "approved" : d.length ? "draft" : "none";
  };

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">AI Real Solutions LLC · Incubator</span>
        <h1>Incubator</h1>
        <p>Every product the LLC owns, on its way to being licensed or sold. Each one gets a business plan, a marketing plan and a sale offer; whatever still stands between it and a buyer becomes a task.</p>
      </header>
      <ErrorBox message={bizError || error} />

      <div className={styles.ventureGrid}>
        {rows.map(({ v, b, its }) => {
          const r = readiness(its);
          return (
            <a key={v.business_id} href={`/office/incubator/${b!.slug}`} className={`${styles.card} ${styles.ventureCard} ${v.stage === "paused" ? styles.taskDone : ""}`}>
              <div className={styles.cardHead}>
                <div>
                  <h2>{b!.name}</h2>
                  <small className={styles.muted}>{b!.category || (b!.relationship === "parent" ? "The Factory & services" : "Product")}</small>
                </div>
                <span className={`${styles.statusPill} ${["licensed", "sold", "for_sale"].includes(v.stage) ? styles.st_paid : ""}`}>{STAGES.find(([k]) => k === v.stage)?.[1]}</span>
              </div>
              <div className={styles.progressRow}>
                <div className={styles.progressBar} role="progressbar" aria-valuenow={r.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${b!.name} sale readiness`}><i style={{ width: `${r.pct}%` }} /></div>
                <small><strong>{r.pct}%</strong> ready to sell · {r.done}/{r.total}</small>
              </div>
              <div className={styles.catDots}>
                {CATEGORIES.map(([k, l]) => {
                  const c = readiness(its.filter((i) => i.category === k));
                  return <span key={k} title={`${l}: ${c.done}/${c.total}`} className={c.total && c.done === c.total ? styles.catDone : undefined}>{l} {c.done}/{c.total}</span>;
                })}
              </div>
              <div className={styles.taskMeta}>
                {(["business_plan", "marketing_plan", "license_offer"] as DocKind[]).map((k) => {
                  const s = docState(v.business_id, k);
                  return <small key={k} className={s === "approved" ? styles.docOk : s === "draft" ? styles.docDraft : styles.muted}>{s === "approved" ? "✓" : s === "draft" ? "◐" : "○"} {DOC_LABEL[k]}</small>;
                })}
              </div>
              {(v.sale_models.length > 0 || v.asking_price_cents) && (
                <small className={styles.muted}>{v.sale_models.map((m) => SALE_MODELS.find(([k]) => k === m)?.[1]).join(" · ")}{v.asking_price_cents ? ` · asking ${money(v.asking_price_cents)}` : ""}</small>
              )}
            </a>
          );
        })}
      </div>
      {!error && rows.length === 0 && <p className={styles.muted}>Loading…</p>}
    </section>
  );
}
