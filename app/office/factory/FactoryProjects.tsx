"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BizTag, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeRest, prettyDate } from "../lib/client";
import { Meter } from "../incubator/IncubatorBoard";
import { ITEM_SELECT, type Item } from "../incubator/types";

type Project = { id: string; slug: string; name: string; summary: string | null; project_type: string; stage: string; progress: number; next_action: string | null; updated_at: string };
const TYPES: [string, string][] = [["core_factory", "Core Factory"], ["client_build", "Client builds"], ["internal_venture", "Internal ventures"], ["graduated_product", "Graduated products"], ["demo", "Demos"]];
const title = (v: string) => v.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function FactoryProjects() {
  const { businesses } = useBusinesses();
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([
        officeRest<Project[]>("factory_projects?select=id,slug,name,summary,project_type,stage,progress,next_action,updated_at&order=updated_at.desc"),
        officeRest<Item[]>(`office_readiness_items?select=${ITEM_SELECT}&limit=5000`).catch(() => []),
      ]);
      setProjects(p); setItems(i);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load Factory projects."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">Factory</span>
          <h1>Factory projects</h1>
          <p>Everything being built in the Software Factory: the Factory itself, the LLC&apos;s ventures and client builds. Open a project to work its assembly line; its business&apos;s readiness is tracked in the Incubator.</p>
        </div>
        <div className={styles.headerActions}>
          <a className="button button-secondary" href="/factory/dashboard">My Factory dashboard</a>
          <a className="button button-primary" href="/build">+ New project</a>
        </div>
      </header>
      <ErrorBox message={error} />
      {TYPES.map(([type, label]) => {
        const list = projects.filter((p) => p.project_type === type);
        if (!list.length) return null;
        return (
          <div key={type} className={styles.group}>
            <h2 className={styles.sectionTitle}>{label} <small>({list.length})</small></h2>
            <div className={styles.ventureGrid}>
              {list.map((p) => {
                const biz = businesses.find((b) => b.factory_project_id === p.id);
                const its = biz ? items.filter((i) => i.business_id === biz.id) : [];
                return (
                  <article key={p.id} className={`${styles.card} ${styles.ventureCard}`}>
                    <div className={styles.cardHead}>
                      <div>
                        <h2><a href={`/factory/projects/${p.slug}`}>{p.name}</a></h2>
                        {biz && <BizTag business={biz} />}
                      </div>
                      <span className={styles.statusPill}>{title(p.stage)}</span>
                    </div>
                    {p.summary && <p>{p.summary}</p>}
                    <div className={styles.meter}>
                      <div className={styles.meterHead}><span>Factory progress</span><strong>{p.progress}%</strong></div>
                      <div className={styles.progressBar} role="progressbar" aria-valuenow={p.progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${p.name} progress`}><i style={{ width: `${p.progress}%` }} /></div>
                    </div>
                    {its.length > 0 && <Meter label="Ready for production" items={its} track="production" compact />}
                    {p.next_action && <small className={styles.muted}>Next: {p.next_action}</small>}
                    <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
                      <a className={styles.smallLink} href={`/factory/projects/${p.slug}`}>Open workspace →</a>
                      {biz && <a className={styles.smallLink} href={`/office/incubator/${biz.slug}`}>Incubator →</a>}
                      <small className={styles.muted}>Updated {prettyDate(p.updated_at.slice(0, 10))}</small>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        );
      })}
      {!error && projects.length === 0 && <p className={styles.muted}>Loading…</p>}
    </section>
  );
}
