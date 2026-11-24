"use client";

import styles from "./office.module.css";
import { OFFICE_MODULES } from "./lib/modules";
import { useBusinesses } from "./useBusinesses";
import type { Business } from "./lib/client";

const STATUS_LABEL = { focus: "Focus", active: "Active", parked: "Parked" } as const;

export default function OfficeHome() {
  const { businesses, entities, loading, error } = useBusinesses();
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const byStatus = (s: Business["status"]) => businesses.filter((b) => b.status === s);
  const upcoming = OFFICE_MODULES.filter((m) => !m.ready).sort((a, b) => a.phase - b.phase);

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">{today}</span>
        <h1>Today</h1>
        <p>
          The daily agenda (morning brief, 3 big goals, a time-blocked day) arrives in phase 1. For now, this is where every business
          of {entities[0]?.legal_name || "AI Real Solutions LLC"} stands.
        </p>
      </header>

      {error && <div className={styles.alert}>{error}</div>}
      {loading && <p className={styles.muted}>Loading businesses…</p>}

      {!loading && !error && (
        <div className={styles.statusGrid}>
          {(["focus", "active", "parked"] as const).map((s) => (
            <div key={s} className={styles.card}>
              <div className={styles.cardHead}>
                <h2>{STATUS_LABEL[s]}</h2>
                <span className={`${styles.pill} ${styles[`pill_${s}`]}`}>{byStatus(s).length}</span>
              </div>
              {byStatus(s).length === 0 && <p className={styles.muted}>None.</p>}
              <ul className={styles.plainList}>
                {byStatus(s).map((b) => (
                  <li key={b.id}>
                    <strong>{b.name}</strong>
                    <small>{b.relationship === "client" ? "Client" : b.relationship === "parent" ? "Parent company" : "Venture"}</small>
                    {b.weekly_focus && <p>{b.weekly_focus}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <p><a className="button button-secondary" href="/office/businesses">Manage businesses →</a></p>

      <h2 className={styles.sectionTitle}>Being built next</h2>
      <div className={styles.moduleGrid}>
        {upcoming.map((m) => (
          <a key={m.slug} className={styles.moduleCard} href={`/office/${m.slug}`}>
            <span className="product-tag">Phase {m.phase}</span>
            <strong>{m.label}</strong>
            <p>{m.summary}</p>
          </a>
        ))}
      </div>
    </section>
  );
}
