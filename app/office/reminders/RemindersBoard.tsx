"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import {
  officeDelete, officeInsert, officePatch, officeRest, officeRpc, prettyDateTime,
  RECURRENCES, REMINDER_SELECT, type Recurrence, type Reminder,
} from "../lib/client";

export default function RemindersBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [items, setItems] = useState<Reminder[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const load = useCallback(async () => {
    setError("");
    try {
      setItems(await officeRest<Reminder[]>(`office_reminders?status=eq.pending&select=${REMINDER_SELECT}&order=remind_at.asc&limit=200`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reminders.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  };
  const snooze = (r: Reminder, ms: number) =>
    act(() => officePatch("office_reminders", `id=eq.${r.id}`, { remind_at: new Date(Math.max(Date.now(), new Date(r.remind_at).getTime()) + ms).toISOString(), last_sent_at: null }));

  const now = Date.now();
  const overdue = items.filter((r) => new Date(r.remind_at).getTime() <= now);
  const upcoming = items.filter((r) => new Date(r.remind_at).getTime() > now);

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Plan</span>
        <h1>Reminders</h1>
        <p>One-time or repeating. Due reminders show on Today and go into the morning brief email when email is set up.</p>
      </header>
      <ErrorBox message={bizError || error} />
      <AddReminder businesses={businesses} onAdded={load} onError={setError} />
      {loading && <p className={styles.muted}>Loading…</p>}
      {!loading && items.length === 0 && <p className={styles.muted}>No reminders.</p>}
      {([["Due now", overdue], ["Coming up", upcoming]] as [string, Reminder[]][]).filter(([, l]) => l.length).map(([label, list]) => (
        <div key={label} className={styles.group}>
          <h2 className={styles.sectionTitle}>{label} <small>({list.length})</small></h2>
          <ul className={`${styles.card} ${styles.plainList}`}>
            {list.map((r) => (
              <li key={r.id} className={styles.reminderRow}>
                <div>
                  <strong>{r.title}</strong>
                  <span className={styles.taskMeta}>
                    <small className={label === "Due now" ? styles.overdue : styles.muted}>{prettyDateTime(r.remind_at)}</small>
                    {r.recurrence !== "none" && <small className={styles.muted}>↻ {RECURRENCES.find((x) => x.value === r.recurrence)?.label}</small>}
                    <BizTag business={r.business_id ? byId.get(r.business_id) : undefined} />
                  </span>
                  {r.notes && <small className={styles.muted}>{r.notes}</small>}
                </div>
                <div className={styles.rowActions}>
                  <button type="button" className={styles.linkButton} onClick={() => void snooze(r, 3600_000)}>+1 hour</button>
                  <button type="button" className={styles.linkButton} onClick={() => void snooze(r, 86_400_000)}>+1 day</button>
                  <button type="button" className={styles.linkButton} onClick={() => void act(() => officeDelete("office_reminders", r.id))}>Delete</button>
                  <button type="button" className="button button-secondary" onClick={() => void act(() => officeRpc("office_complete_reminder", { p_reminder: r.id }))}>Done</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function AddReminder({ businesses, onAdded, onError }: { businesses: ReturnType<typeof useBusinesses>["businesses"]; onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [business, setBusiness] = useState("");
  const [busy, setBusy] = useState(false);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !when) return;
    setBusy(true);
    onError("");
    try {
      // datetime-local is the viewer's own clock; Date turns it into the right instant.
      await officeInsert("office_reminders", { title: title.trim(), remind_at: new Date(when).toISOString(), recurrence, business_id: business || null });
      setTitle(""); setWhen(""); setRecurrence("none");
      await onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the reminder.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
      <div className={styles.formGrid4}>
        <label className={`${styles.field} ${styles.span2}`}>Remind me to<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Send the monthly invoices" required /></label>
        <label className={styles.field}>When<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
        <label className={styles.field}>Repeats
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
        <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} />
      </div>
      <div className={styles.rowEnd}><button className="button button-primary" type="submit" disabled={busy || !title.trim() || !when}>{busy ? "Adding…" : "Add reminder"}</button></div>
    </form>
  );
}
