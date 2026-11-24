"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BusinessSelect, ErrorBox } from "../components";
import { TaskRow } from "../TaskRow";
import { useBusinesses } from "../useBusinesses";
import {
  officeInsert, officePatch, officeRest, officeRpc, officeToday, shiftDate,
  GOAL_SELECT, RECURRENCES, TASK_SELECT, type Goal, type Recurrence, type Task,
} from "../lib/client";

type View = "open" | "done";

export default function TasksBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [view, setView] = useState<View>("open");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const today = officeToday();
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const load = useCallback(async () => {
    setError("");
    try {
      const q = view === "open"
        ? `office_tasks?status=eq.todo&select=${TASK_SELECT}&order=due_on.asc.nullslast,priority.asc&limit=500`
        : `office_tasks?status=in.(done,dropped)&select=${TASK_SELECT}&order=completed_at.desc.nullslast,updated_at.desc&limit=100`;
      const [t, g] = await Promise.all([officeRest<Task[]>(q), officeRest<Goal[]>(`office_goals?status=eq.open&select=${GOAL_SELECT}&order=level.asc`)]);
      setTasks(t);
      setGoals(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(""); }
  };

  const shown = tasks.filter((t) => !filter || t.business_id === filter);
  const weekEnd = shiftDate(today, 7);
  const groups: [string, Task[]][] = view === "open"
    ? [
        ["Overdue", shown.filter((t) => t.due_on && t.due_on < today)],
        ["Today", shown.filter((t) => t.due_on === today)],
        ["Next 7 days", shown.filter((t) => t.due_on && t.due_on > today && t.due_on <= weekEnd)],
        ["Later", shown.filter((t) => t.due_on && t.due_on > weekEnd)],
        ["No date", shown.filter((t) => !t.due_on)],
      ]
    : [["Recently finished", shown]];

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Plan</span>
        <h1>Tasks</h1>
        <p>Every task for every business. The daily planner picks from the open ones; finished repeating tasks come back on their next date.</p>
      </header>
      <ErrorBox message={bizError || error} />

      <AddTask businesses={businesses} goals={goals} onAdded={load} onError={setError} />

      <div className={styles.toolbar}>
        <div className={styles.segmented} role="group" aria-label="Show">
          {(["open", "done"] as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} className={view === v ? styles.seg_focus : undefined} onClick={() => setView(v)}>
              {v === "open" ? "Open" : "Finished"}
            </button>
          ))}
        </div>
        <div className={styles.toolbarField}>
          <BusinessSelect businesses={businesses} value={filter} onChange={setFilter} noneLabel="All businesses" label="Filter" />
        </div>
      </div>

      {loading && <p className={styles.muted}>Loading…</p>}
      {!loading && shown.length === 0 && <p className={styles.muted}>{view === "open" ? "No open tasks. Add one above or use Quick capture on Today." : "Nothing finished yet."}</p>}
      {groups.filter(([, list]) => list.length).map(([label, list]) => (
        <div key={label} className={styles.group}>
          <h2 className={styles.sectionTitle}>{label} <small>({list.length})</small></h2>
          <ul className={`${styles.taskList} ${styles.card}`}>
            {list.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                business={t.business_id ? byId.get(t.business_id) : undefined}
                busy={busy === t.id}
                onComplete={(x) => void act(x.id, () => officeRpc("office_complete_task", { p_task: x.id }))}
                onReopen={(x) => void act(x.id, () => officePatch("office_tasks", `id=eq.${x.id}`, { status: "todo", completed_at: null }))}
                onDue={view === "open" ? (x, due) => void act(x.id, () => officePatch("office_tasks", `id=eq.${x.id}`, { due_on: due })) : undefined}
                onDrop={view === "open" ? (x) => void act(x.id, () => officePatch("office_tasks", `id=eq.${x.id}`, { status: "dropped" })) : undefined}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function AddTask({ businesses, goals, onAdded, onError }: {
  businesses: ReturnType<typeof useBusinesses>["businesses"]; goals: Goal[]; onAdded: () => Promise<void>; onError: (m: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [business, setBusiness] = useState("");
  const [goal, setGoal] = useState("");
  const [due, setDue] = useState("");
  const [estimate, setEstimate] = useState("");
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [recurrence, setRecurrence] = useState<Recurrence>("none");
  const [busy, setBusy] = useState(false);
  const goalOptions = goals.filter((g) => !business || g.business_id === business);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    onError("");
    try {
      const g = goals.find((x) => x.id === goal);
      await officeInsert("office_tasks", {
        title: title.trim(),
        business_id: business || g?.business_id || null,
        goal_id: goal || null,
        due_on: due || null,
        estimate_min: Number(estimate) > 0 ? Math.round(Number(estimate)) : null,
        priority,
        recurrence,
      });
      setTitle(""); setDue(""); setEstimate(""); setGoal(""); setRecurrence("none"); setPriority(2);
      await onAdded();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the task.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${styles.card} ${styles.addForm}`} onSubmit={add}>
      <div className={styles.formGrid4}>
        <label className={`${styles.field} ${styles.span2}`}>New task<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" required /></label>
        <BusinessSelect businesses={businesses} value={business} onChange={(v) => { setBusiness(v); setGoal(""); }} />
        <label className={styles.field}>Goal
          <select value={goal} onChange={(e) => setGoal(e.target.value)}>
            <option value="">None</option>
            {goalOptions.map((g) => <option key={g.id} value={g.id}>{g.level}: {g.title}</option>)}
          </select>
        </label>
        <label className={styles.field}>Due<input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        <label className={styles.field}>Minutes<input type="number" min={5} step={5} value={estimate} onChange={(e) => setEstimate(e.target.value)} placeholder="45" /></label>
        <label className={styles.field}>Priority
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>High</option><option value={2}>Normal</option><option value={3}>Low</option>
          </select>
        </label>
        <label className={styles.field}>Repeats
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as Recurrence)}>
            {RECURRENCES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.rowEnd}><button className="button button-primary" type="submit" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Add task"}</button></div>
    </form>
  );
}
