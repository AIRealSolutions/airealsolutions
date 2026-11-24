"use client";

import { useEffect, useState } from "react";
import { Meter } from "../incubator/IncubatorBoard";
import { ITEM_SELECT, type Item } from "../incubator/types";
import styles from "../office.module.css";
import { officeRest, type Business } from "../lib/client";
import { useBusinesses } from "../useBusinesses";

const GROUPS: { key: Business["relationship"]; title: string; note: string }[] = [
  { key: "parent", title: "The company", note: "AI Real Solutions LLC: the legal entity that keeps the books." },
  { key: "venture", title: "Ventures", note: "Products the LLC owns. Each one is tracked as its own business line in the LLC's books." },
  { key: "client", title: "Clients", note: "Outside businesses the LLC builds for and bills. The Office tracks only their development goals." },
];
const STATUSES: Business["status"][] = ["focus", "active", "parked"];
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export default function BusinessesBoard() {
  const { businesses, setBusinesses, entities, loading, error, reload } = useBusinesses();
  const [msg, setMsg] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => { officeRest<Item[]>(`office_readiness_items?select=${ITEM_SELECT}&limit=5000`).then(setItems, () => setItems([])); }, [businesses.length]);

  async function patch(b: Business, change: Partial<Business>) {
    setMsg("");
    const before = businesses;
    setBusinesses((list) => list.map((x) => (x.id === b.id ? { ...x, ...change } : x)));
    try {
      await officeRest(`office_businesses?id=eq.${b.id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(change),
      });
      return true;
    } catch (e) {
      setBusinesses(before);
      setMsg(e instanceof Error ? e.message : "Could not save.");
      return false;
    }
  }

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">{entities[0]?.legal_name || "AI Real Solutions LLC"}</span>
        <h1>Businesses</h1>
        <p>Every goal, task, reminder, invoice and journal line in the Office is tagged with one of these. Focus businesses get the most room in your daily agenda.</p>
      </header>

      {(error || msg) && <div className={styles.alert}>{error || msg}</div>}
      {loading && <p className={styles.muted}>Loading…</p>}

      {!loading && !error &&
        GROUPS.map((g) => {
          const rows = businesses.filter((b) => b.relationship === g.key);
          return (
            <div key={g.key} className={styles.group}>
              <h2 className={styles.sectionTitle}>{g.title} <small>({rows.length})</small></h2>
              <p className={styles.muted}>{g.note}</p>
              <div className={styles.businessGrid}>
                {rows.map((b) => (
                  <BusinessCard key={b.id} b={b} items={items.filter((i) => i.business_id === b.id)} onPatch={(c) => patch(b, c)} />
                ))}
              </div>
            </div>
          );
        })}

      {!loading && !error && entities[0] && (
        <AddBusiness entityId={entities[0].id} existing={businesses} onAdded={reload} onError={setMsg} />
      )}
    </section>
  );
}

function BusinessCard({ b, items, onPatch }: { b: Business; items: Item[]; onPatch: (c: Partial<Business>) => Promise<boolean> }) {
  const [focus, setFocus] = useState(b.weekly_focus || "");
  const [saved, setSaved] = useState(false);
  const dirty = focus !== (b.weekly_focus || "");

  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <div>
          <h3>{b.name}</h3>
          <small className={styles.muted}>
            {b.category || "—"}
            {b.website && (
              <> · <a href={b.website} target="_blank" rel="noreferrer">{b.website.replace(/^https?:\/\//, "")}</a></>
            )}
          </small>
        </div>
        {b.factory_project_id && <span className={styles.pill}>In the Factory</span>}
      </div>
      {b.summary && <p>{b.summary}</p>}
      {items.length > 0 && (
        <a href={`/office/incubator/${b.slug}`} className={styles.meterLink}>
          <Meter label="Ready for production" items={items} track="production" compact />
          {b.relationship !== "client" && <Meter label="Ready to sell" items={items} track="sale" compact />}
        </a>
      )}
      <div className={styles.segmented} role="group" aria-label={`${b.name} status`}>
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={b.status === s ? styles[`seg_${s}`] : undefined}
            aria-pressed={b.status === s}
            onClick={() => b.status !== s && void onPatch({ status: s })}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <label className={styles.field}>
        This week&apos;s focus
        <textarea
          rows={2}
          value={focus}
          placeholder="e.g. Finish the layout agent demo"
          onChange={(e) => { setFocus(e.target.value); setSaved(false); }}
        />
      </label>
      <div className={styles.rowEnd}>
        {saved && <small className={styles.muted}>Saved</small>}
        <button
          type="button"
          className="button button-secondary"
          disabled={!dirty}
          onClick={async () => { if (await onPatch({ weekly_focus: focus.trim() || null })) setSaved(true); }}
        >
          Save focus
        </button>
      </div>
    </article>
  );
}

function AddBusiness({ entityId, existing, onAdded, onError }: {
  entityId: string; existing: Business[]; onAdded: () => Promise<void>; onError: (m: string) => void;
}) {
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<Business["relationship"]>("client");
  const [category, setCategory] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const slug = slugify(name);
    if (!slug) return onError("Enter a business name.");
    if (existing.some((b) => b.slug === slug)) return onError(`A business called “${name}” already exists.`);
    setBusy(true);
    onError("");
    try {
      await officeRest("office_businesses", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          entity_id: entityId,
          name: name.trim(),
          slug,
          relationship,
          category: category.trim() || null,
          website: website.trim() || null,
          sort_order: (Math.max(0, ...existing.map((b) => b.sort_order)) || 0) + 10,
        }),
      });
      setName(""); setCategory(""); setWebsite("");
      await onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the business.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
      <h2>Add a business</h2>
      <div className={styles.formGrid}>
        <label className={styles.field}>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Client or venture name" required /></label>
        <label className={styles.field}>Type
          <select value={relationship} onChange={(e) => setRelationship(e.target.value as Business["relationship"])}>
            <option value="client">Client</option>
            <option value="venture">Venture (owned by the LLC)</option>
          </select>
        </label>
        <label className={styles.field}>Category<input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Law firm, SaaS" /></label>
        <label className={styles.field}>Website<input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" type="url" /></label>
      </div>
      <div className={styles.rowEnd}>
        <button className="button button-primary" type="submit" disabled={busy}>{busy ? "Adding…" : "Add business"}</button>
      </div>
    </form>
  );
}
