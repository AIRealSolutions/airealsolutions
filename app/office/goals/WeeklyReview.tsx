"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BizTag } from "../components";
import { api } from "../../factory/connections/session";
import { officeInsert, officePatch, officeRest, shiftDate, type Business } from "../lib/client";

type Proposal = { business_slug: string; weekly_focus: string; goals: string[] };
type Review = { id: string; week_start: string; summary: string | null; wins: string[]; misses: string[]; proposals: Proposal[]; status: "draft" | "accepted"; source: "ai" | "quick" };

/** Latest weekly review, with one click to adopt next week's focus and goals. */
export function WeeklyReview({ businesses, onAccepted }: { businesses: Business[]; onAccepted: () => Promise<void> }) {
  const [review, setReview] = useState<Review | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const bySlug = new Map(businesses.map((b) => [b.slug, b]));

  const pick = (r: Review | null) => {
    setReview(r);
    const all = new Set<string>();
    r?.proposals.forEach((p, i) => { if (p.weekly_focus) all.add(`f${i}`); p.goals.forEach((_, j) => all.add(`g${i}-${j}`)); });
    setPicked(all);
  };
  const load = useCallback(async () => {
    try {
      const rows = await officeRest<Review[]>("office_weekly_reviews?select=id,week_start,summary,wins,misses,proposals,status,source&order=week_start.desc&limit=1");
      pick(rows[0] ?? null);
    } catch { /* table may not exist yet; the Goals page shows its own error */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function run() {
    setBusy("run");
    setMsg("");
    try {
      const r = await api<{ review: Review; warning: string | null }>("/api/office/review", { method: "POST", body: "{}" });
      pick(r.review);
      if (r.warning) setMsg(r.warning);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not run the review.");
    } finally {
      setBusy("");
    }
  }

  async function accept() {
    if (!review) return;
    setBusy("accept");
    setMsg("");
    try {
      const nextSunday = shiftDate(review.week_start, 13);
      let goals = 0, focus = 0;
      for (const [i, p] of review.proposals.entries()) {
        const b = bySlug.get(p.business_slug);
        if (!b) continue;
        if (picked.has(`f${i}`) && p.weekly_focus) { await officePatch("office_businesses", `id=eq.${b.id}`, { weekly_focus: p.weekly_focus }); focus++; }
        for (const [j, title] of p.goals.entries()) {
          if (picked.has(`g${i}-${j}`)) { await officeInsert("office_goals", { business_id: b.id, level: "week", title, due_on: nextSunday }); goals++; }
        }
      }
      await officePatch("office_weekly_reviews", `id=eq.${review.id}`, { status: "accepted" });
      setReview({ ...review, status: "accepted" });
      setMsg(`Added ${goals} week goal${goals === 1 ? "" : "s"} and set ${focus} weekly focus${focus === 1 ? "" : "es"}.`);
      await onAccepted();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not apply the review.");
    } finally {
      setBusy("");
    }
  }

  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <article className={`${styles.card} ${styles.reviewCard}`}>
      <div className={styles.cardHead}>
        <div>
          <h2>Weekly review</h2>
          <small className={styles.muted}>
            {review ? `Week of ${new Date(`${review.week_start}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} · ${review.source === "ai" ? "AI" : "quick"} · ${review.status}` : "Runs on its own Sunday evening, or now."}
          </small>
        </div>
        <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void run()}>{busy === "run" ? "Reviewing…" : review ? "Run again" : "Run weekly review"}</button>
      </div>
      {msg && <small className={styles.muted} role="status">{msg}</small>}
      {review && (
        <>
          {review.summary && <p className={styles.brief}>{review.summary}</p>}
          <div className={styles.formGrid}>
            <div><strong>Wins</strong><ul className={styles.list}>{review.wins.length ? review.wins.map((w, i) => <li key={i}>{w}</li>) : <li>—</li>}</ul></div>
            <div><strong>Slipped</strong><ul className={styles.list}>{review.misses.length ? review.misses.map((w, i) => <li key={i}>{w}</li>) : <li>—</li>}</ul></div>
          </div>
          {review.proposals.length > 0 && (
            <>
              <strong>Next week</strong>
              <div className={styles.proposals}>
                {review.proposals.map((p, i) => (
                  <div key={i} className={styles.proposal}>
                    <BizTag business={bySlug.get(p.business_slug)} />
                    {p.weekly_focus && (
                      <label className={styles.check}><input type="checkbox" disabled={review.status === "accepted"} checked={picked.has(`f${i}`)} onChange={() => toggle(`f${i}`)} /> Focus: {p.weekly_focus}</label>
                    )}
                    {p.goals.map((g, j) => (
                      <label key={j} className={styles.check}><input type="checkbox" disabled={review.status === "accepted"} checked={picked.has(`g${i}-${j}`)} onChange={() => toggle(`g${i}-${j}`)} /> Week goal: {g}</label>
                    ))}
                  </div>
                ))}
              </div>
              {review.status === "draft" && (
                <div className={styles.rowEnd}>
                  <button type="button" className="button button-primary" disabled={!!busy || picked.size === 0} onClick={() => void accept()}>{busy === "accept" ? "Adding…" : `Use ${picked.size} selected`}</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </article>
  );
}
