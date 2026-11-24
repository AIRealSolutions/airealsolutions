"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { officeInsert, officePatch, officeRest, prettyDate, GOAL_LEVELS, GOAL_SELECT, type Business, type Goal, type GoalLevel } from "../lib/client";

type TaskLink = { goal_id: string; status: string };
const LEVEL_LABEL: Record<GoalLevel, string> = { year: "Year", quarter: "Quarter", month: "Month", week: "Week", day: "Day" };

export default function GoalsBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [links, setLinks] = useState<TaskLink[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const [g, t] = await Promise.all([
        officeRest<Goal[]>(`office_goals?select=${GOAL_SELECT}${showDone ? "" : "&status=eq.open"}&order=sort_order.asc,due_on.asc.nullslast`),
        officeRest<TaskLink[]>("office_tasks?goal_id=not.is.null&status=in.(todo,done)&select=goal_id,status"),
      ]);
      setGoals(g);
      setLinks(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load goals.");
    } finally {
      setLoading(false);
    }
  }, [showDone]);
  useEffect(() => { void load(); }, [load]);

  const save = async (g: Goal, change: Partial<Goal>) => {
    try { await officePatch("office_goals", `id=eq.${g.id}`, change); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  };

  const taskCounts = useMemo(() => {
    const m = new Map<string, { open: number; done: number }>();
    for (const l of links) {
      const c = m.get(l.goal_id) || { open: 0, done: 0 };
      if (l.status === "done") c.done++; else c.open++;
      m.set(l.goal_id, c);
    }
    return m;
  }, [links]);

  const withGoals = businesses.filter((b) => goals.some((g) => g.business_id === b.id));

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Plan</span>
        <h1>Goals</h1>
        <p>One tree for each business: year, quarter, month, week, day. Link tasks to a goal and the daily planner will push the work that moves it.</p>
      </header>
      <ErrorBox message={bizError || error} />

      <AddGoal businesses={businesses} goals={goals} onAdded={load} onError={setError} />

      <label className={styles.check}><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show finished and dropped goals</label>

      {loading && <p className={styles.muted}>Loading…</p>}
      {!loading && withGoals.length === 0 && <p className={styles.muted}>No goals yet. Start with one quarter goal for each Focus business.</p>}
      {withGoals.map((b) => (
        <div key={b.id} className={styles.group}>
          <h2 className={styles.sectionTitle}>{b.name} <small>· {b.status}</small></h2>
          <div className={styles.card}>
            <GoalTree goals={goals.filter((g) => g.business_id === b.id)} parent={null} counts={taskCounts} onSave={save} depth={0} />
          </div>
        </div>
      ))}
    </section>
  );
}

function GoalTree({ goals, parent, counts, onSave, depth }: {
  goals: Goal[]; parent: string | null; counts: Map<string, { open: number; done: number }>; onSave: (g: Goal, c: Partial<Goal>) => Promise<void>; depth: number;
}) {
  const ids = new Set(goals.map((g) => g.id));
  const level = (l: GoalLevel) => GOAL_LEVELS.indexOf(l);
  const children = goals
    .filter((g) => (parent === null ? !g.parent_id || !ids.has(g.parent_id) : g.parent_id === parent))
    .sort((a, b) => level(a.level) - level(b.level));
  if (!children.length) return null;
  return (
    <ul className={depth ? styles.goalChildren : styles.goalTree}>
      {children.map((g) => (
        <li key={g.id}>
          <GoalItem goal={g} counts={counts.get(g.id)} onSave={onSave} />
          {depth < 5 && <GoalTree goals={goals} parent={g.id} counts={counts} onSave={onSave} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function GoalItem({ goal, counts, onSave }: { goal: Goal; counts?: { open: number; done: number }; onSave: (g: Goal, c: Partial<Goal>) => Promise<void> }) {
  const [value, setValue] = useState(String(goal.current_value ?? 0));
  useEffect(() => setValue(String(goal.current_value ?? 0)), [goal.current_value]);
  const hasTarget = goal.target_value != null && Number(goal.target_value) > 0;
  const pct = hasTarget ? Math.min(100, Math.round((Number(goal.current_value) / Number(goal.target_value)) * 100)) : null;
  const closed = goal.status !== "open";
  return (
    <div className={`${styles.goalItem} ${closed ? styles.taskDone : ""}`}>
      <div className={styles.goalHead}>
        <span className={styles.levelBadge}>{LEVEL_LABEL[goal.level]}</span>
        <strong>{goal.title}</strong>
        {goal.due_on && <small className={styles.muted}>by {prettyDate(goal.due_on)}</small>}
        {counts && <small className={styles.muted}>{counts.done}/{counts.open + counts.done} tasks done</small>}
        {closed && <small className={styles.muted}>{goal.status}</small>}
      </div>
      {hasTarget && (
        <div className={styles.progressRow}>
          <div className={styles.progressBar} role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${goal.title} progress`}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <small>{Number(goal.current_value).toLocaleString()} / {Number(goal.target_value).toLocaleString()} {goal.unit || ""}</small>
        </div>
      )}
      {!closed && (
        <div className={styles.goalActions}>
          {hasTarget && (
            <>
              <input type="number" className={styles.smallInput} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Current value" />
              <button type="button" className={styles.linkButton} disabled={Number(value) === Number(goal.current_value)} onClick={() => void onSave(goal, { current_value: Number(value) || 0 })}>Update</button>
            </>
          )}
          <button type="button" className={styles.linkButton} onClick={() => void onSave(goal, { status: "done" })}>Mark done</button>
          <button type="button" className={styles.linkButton} onClick={() => void onSave(goal, { status: "dropped" })}>Drop</button>
        </div>
      )}
      {closed && <div className={styles.goalActions}><button type="button" className={styles.linkButton} onClick={() => void onSave(goal, { status: "open" })}>Reopen</button></div>}
    </div>
  );
}

function AddGoal({ businesses, goals, onAdded, onError }: { businesses: Business[]; goals: Goal[]; onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const [business, setBusiness] = useState("");
  const [level, setLevel] = useState<GoalLevel>("quarter");
  const [parent, setParent] = useState("");
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const parents = goals.filter((g) => g.business_id === business && g.status === "open" && GOAL_LEVELS.indexOf(g.level) < GOAL_LEVELS.indexOf(level));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!business) return onError("Pick the business this goal belongs to.");
    if (!title.trim()) return;
    setBusy(true);
    onError("");
    try {
      await officeInsert("office_goals", {
        business_id: business, level, parent_id: parent || null, title: title.trim(),
        target_value: Number(target) > 0 ? Number(target) : null, unit: unit.trim() || null, due_on: due || null,
      });
      setTitle(""); setTarget(""); setUnit(""); setDue(""); setParent("");
      await onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the goal.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
      <div className={styles.formGrid4}>
        <BusinessSelect businesses={businesses} value={business} onChange={(v) => { setBusiness(v); setParent(""); }} noneLabel="Choose…" />
        <label className={styles.field}>Level
          <select value={level} onChange={(e) => { setLevel(e.target.value as GoalLevel); setParent(""); }}>
            {GOAL_LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${styles.span2}`}>Part of
          <select value={parent} onChange={(e) => setParent(e.target.value)} disabled={!parents.length}>
            <option value="">{parents.length ? "Top-level goal" : "No bigger goal to attach to"}</option>
            {parents.map((g) => <option key={g.id} value={g.id}>{LEVEL_LABEL[g.level]}: {g.title}</option>)}
          </select>
        </label>
        <label className={`${styles.field} ${styles.span2}`}>Goal<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sign 2 cemetery pilot customers" required /></label>
        <label className={styles.field}>Target (optional)<input type="number" min={0} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="2" /></label>
        <label className={styles.field}>Unit<input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="customers, $, posts" /></label>
        <label className={styles.field}>Due<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      </div>
      <div className={styles.rowEnd}><button className="button button-primary" type="submit" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Add goal"}</button></div>
    </form>
  );
}
