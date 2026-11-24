"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./office.module.css";
import { BizTag, ErrorBox } from "./components";
import { TaskRow } from "./TaskRow";
import { useBusinesses } from "./useBusinesses";
import { api } from "../factory/connections/session";
import {
  endOfOfficeDay, officeRest, officePatch, officeRpc, officeToday, prettyDateTime, shiftDate,
  REMINDER_SELECT, TASK_SELECT, type DailyPlan, type Reminder, type Task,
} from "./lib/client";

type PlanResponse = { plan: DailyPlan; source: "ai" | "quick"; warning: string | null };
type CaptureResponse = { kind: "task" | "note" | "reminder"; business: string | null; ai: boolean };

export default function OfficeHome() {
  const { businesses, error: bizError } = useBusinesses();
  const today = officeToday();
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [planning, setPlanning] = useState<"" | "ai" | "quick">("");
  const [warning, setWarning] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busyTask, setBusyTask] = useState("");
  const [news, setNews] = useState<{ id: string; title: string; url: string | null; business_id: string | null; summary: string | null }[]>([]);

  const bySlug = useMemo(() => new Map(businesses.map((b) => [b.slug, b])), [businesses]);
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);

  const load = useCallback(async () => {
    setError("");
    try {
      const startOfDay = endOfOfficeDay(shiftDate(today, -1));
      const [p, t, r] = await Promise.all([
        officeRest<DailyPlan[]>(`office_daily_plans?plan_date=eq.${today}&select=*&limit=1`),
        officeRest<Task[]>(`office_tasks?or=(status.eq.todo,completed_at.gte.${encodeURIComponent(startOfDay)})&select=${TASK_SELECT}&order=priority.asc,due_on.asc.nullslast&limit=300`),
        officeRest<Reminder[]>(`office_reminders?status=eq.pending&remind_at=lt.${encodeURIComponent(endOfOfficeDay(today))}&select=${REMINDER_SELECT}&order=remind_at.asc`),
      ]);
      setPlan(p[0] ?? null);
      officeRest<typeof news>("office_feed_items?status=eq.new&kind=eq.news&score=gte.70&select=id,title,url,business_id,summary&order=score.desc,created_at.desc&limit=3")
        .then(setNews, () => setNews([]));
      setTasks(t);
      setReminders(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load today.");
    } finally {
      setLoading(false);
    }
  }, [today]);

  useEffect(() => {
    void load();
    fetch("/api/office/plan").then((r) => r.json()).then((d) => setAiReady(Boolean(d.aiConfigured)), () => setAiReady(false));
  }, [load]);

  async function makePlan(mode: "ai" | "quick") {
    setPlanning(mode);
    setWarning("");
    setError("");
    try {
      const res = await api<PlanResponse>("/api/office/plan", { method: "POST", body: JSON.stringify({ mode }) });
      setPlan(res.plan);
      setWarning(res.warning || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the plan.");
    } finally {
      setPlanning("");
    }
  }

  async function complete(t: Task) {
    setBusyTask(t.id);
    try {
      await officeRpc("office_complete_task", { p_task: t.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the task.");
    } finally {
      setBusyTask("");
    }
  }
  async function reopen(t: Task) {
    setBusyTask(t.id);
    try {
      await officePatch("office_tasks", `id=eq.${t.id}`, { status: "todo", completed_at: null });
      await load();
    } finally {
      setBusyTask("");
    }
  }

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const inPlan = useMemo(() => new Set((plan?.agenda || []).map((a) => a.task_id).filter(Boolean)), [plan]);
  const dueNotPlanned = tasks.filter((t) => t.status === "todo" && t.due_on && t.due_on <= today && !inPlan.has(t.id));
  const unfinished = tasks.filter((t) => t.status === "todo" && t.due_on && t.due_on <= today);
  const doneToday = tasks.filter((t) => t.status === "done").length;
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  return (
    <section className={styles.page}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">{dateLabel}</span>
          <h1>Today</h1>
          <p>{doneToday ? `${doneToday} done so far. ` : ""}Plan the day, capture what comes up, and close it out tonight.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="button button-primary" disabled={!!planning} onClick={() => void makePlan(aiReady === false ? "quick" : "ai")}>
            {planning ? "Planning…" : plan ? "Re-plan my day" : "Plan my day"}
          </button>
          {aiReady !== false && (
            <button className="button button-secondary" disabled={!!planning} onClick={() => void makePlan("quick")}>Quick plan (no AI)</button>
          )}
        </div>
      </header>

      <ErrorBox message={bizError || error} />
      {warning && <div className={styles.note}>{warning}</div>}
      {loading && <p className={styles.muted}>Loading today…</p>}

      {!loading && (
        <div className={styles.todayGrid}>
          <div className={styles.stack}>
            {/* Plan */}
            <article className={styles.card}>
              <div className={styles.cardHead}>
                <h2>Morning brief</h2>
                {plan && <span className={styles.pill}>{plan.source === "ai" ? "AI plan" : "Quick plan"}</span>}
              </div>
              {plan ? <p className={styles.brief}>{plan.brief}</p> : (
                <p className={styles.muted}>No plan yet for today. Press <strong>Plan my day</strong> and the planner will pick your 3 big goals and lay out the day around your calendar.</p>
              )}
            </article>

            {plan && (
              <article className={styles.card}>
                <h2>Today&apos;s 3 big goals</h2>
                {plan.big_goals.length === 0 && <p className={styles.muted}>Add some tasks and re-plan.</p>}
                <ol className={styles.bigGoals}>
                  {plan.big_goals.map((g, i) => {
                    const t = g.task_id ? taskById.get(g.task_id) : undefined;
                    return (
                      <li key={i} className={t?.status === "done" ? styles.taskDone : undefined}>
                        <div>
                          <strong>{g.title}</strong>
                          <span className={styles.taskMeta}><BizTag business={bySlug.get(g.business_slug)} /><small className={styles.muted}>{g.reason}</small></span>
                        </div>
                        {t && (
                          <input type="checkbox" checked={t.status === "done"} disabled={busyTask === t.id} aria-label={`Complete ${g.title}`}
                            onChange={() => void (t.status === "done" ? reopen(t) : complete(t))} />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </article>
            )}

            {plan && (
              <article className={styles.card}>
                <h2>Agenda</h2>
                {plan.agenda.length === 0 && <p className={styles.muted}>Nothing scheduled.</p>}
                <ul className={styles.agenda}>
                  {plan.agenda.map((a, i) => {
                    const t = a.task_id ? taskById.get(a.task_id) : undefined;
                    return (
                      <li key={i} className={`${styles[`agenda_${a.kind}`]} ${t?.status === "done" ? styles.taskDone : ""}`}>
                        <time>{a.start}<span>–{a.end}</span></time>
                        <div>
                          <strong>{a.title}</strong>
                          <span className={styles.taskMeta}>
                            <BizTag business={bySlug.get(a.business_slug)} />
                            {a.kind !== "task" && <small className={styles.muted}>{a.kind}</small>}
                          </span>
                        </div>
                        {t && (
                          <input type="checkbox" checked={t.status === "done"} disabled={busyTask === t.id} aria-label={`Complete ${a.title}`}
                            onChange={() => void (t.status === "done" ? reopen(t) : complete(t))} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </article>
            )}
          </div>

          <div className={styles.stack}>
            <CaptureBox onCaptured={load} />

            <article className={styles.card}>
              <div className={styles.cardHead}><h2>Reminders</h2><a className={styles.smallLink} href="/office/reminders">All →</a></div>
              {reminders.length === 0 && <p className={styles.muted}>Nothing due today.</p>}
              <ul className={styles.plainList}>
                {reminders.map((r) => (
                  <li key={r.id} className={styles.reminderRow}>
                    <div>
                      <strong>{r.title}</strong>
                      <span className={styles.taskMeta}>
                        <small className={new Date(r.remind_at) < new Date() ? styles.overdue : styles.muted}>{prettyDateTime(r.remind_at)}</small>
                        <BizTag business={r.business_id ? byId.get(r.business_id) : undefined} />
                      </span>
                    </div>
                    <button type="button" className="button button-secondary" onClick={async () => { await officeRpc("office_complete_reminder", { p_reminder: r.id }); await load(); }}>Done</button>
                  </li>
                ))}
              </ul>
            </article>

            {news.length > 0 && (
              <article className={styles.card}>
                <div className={styles.cardHead}><h2>Top news</h2><a className={styles.smallLink} href="/office/feed">Feed →</a></div>
                <ul className={styles.plainList}>
                  {news.map((n) => (
                    <li key={n.id}>
                      {n.url && /^https?:\/\//i.test(n.url) ? <a className={styles.feedTitle} href={n.url} target="_blank" rel="noopener noreferrer nofollow">{n.title}</a> : <strong>{n.title}</strong>}
                      <span className={styles.taskMeta}><BizTag business={n.business_id ? byId.get(n.business_id) : undefined} /></span>
                      {n.summary && <small className={styles.muted}>{n.summary}</small>}
                    </li>
                  ))}
                </ul>
              </article>
            )}

            <article className={styles.card}>
              <div className={styles.cardHead}><h2>Also due</h2><a className={styles.smallLink} href="/office/tasks">All tasks →</a></div>
              {dueNotPlanned.length === 0 && <p className={styles.muted}>{plan ? "Everything due is on the agenda." : "Nothing due today."}</p>}
              <ul className={styles.taskList}>
                {dueNotPlanned.map((t) => (
                  <TaskRow key={t.id} task={t} business={t.business_id ? byId.get(t.business_id) : undefined} busy={busyTask === t.id} onComplete={(x) => void complete(x)} />
                ))}
              </ul>
            </article>

            <CheckIn plan={plan} unfinished={unfinished} today={today} onChanged={load} />
          </div>
        </div>
      )}
    </section>
  );
}

function CaptureBox({ onCaptured }: { onCaptured: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await api<CaptureResponse>("/api/office/capture", { method: "POST", body: JSON.stringify({ text }) });
      setMsg(`Saved as a ${r.kind}${r.business ? ` for ${r.business}` : ""}${r.ai ? "" : " (AI is off, so captures are saved as notes)"}.`);
      setText("");
      await onCaptured();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.card} onSubmit={submit}>
      <h2>Quick capture</h2>
      <label className={styles.field}>
        <span className={styles.srOnly}>Capture</span>
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Send Lightkeeper the homepage draft by Friday · Remind me at 3pm to call the county · Idea: NCIssues weekly digest"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e); }}
        />
      </label>
      <div className={styles.rowEnd}>
        {msg && <small className={styles.muted} role="status">{msg}</small>}
        <button className="button button-primary" type="submit" disabled={busy || !text.trim()}>{busy ? "Filing…" : "Capture"}</button>
      </div>
    </form>
  );
}

function CheckIn({ plan, unfinished, today, onChanged }: { plan: DailyPlan | null; unfinished: Task[]; today: string; onChanged: () => Promise<void> }) {
  const [reflection, setReflection] = useState(plan?.reflection || "");
  const [msg, setMsg] = useState("");
  useEffect(() => setReflection(plan?.reflection || ""), [plan?.id, plan?.reflection]);

  async function save() {
    setMsg("");
    try {
      if (plan) await officePatch("office_daily_plans", `id=eq.${plan.id}`, { reflection: reflection.trim() || null });
      else await officeRest("office_daily_plans", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ plan_date: today, reflection: reflection.trim() || null, source: "quick" }) });
      setMsg("Saved. Tomorrow's plan will take it into account.");
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not save.");
    }
  }
  async function rollOver() {
    setMsg("");
    try {
      await officePatch("office_tasks", `id=in.(${unfinished.map((t) => t.id).join(",")})`, { due_on: shiftDate(today, 1) });
      setMsg(`Moved ${unfinished.length} task${unfinished.length === 1 ? "" : "s"} to tomorrow.`);
      await onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not move tasks.");
    }
  }
  return (
    <article className={styles.card}>
      <h2>Evening check-in</h2>
      <label className={styles.field}>
        How did today go? What got in the way?
        <textarea rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="Two sentences is plenty." />
      </label>
      <div className={styles.rowEnd}>
        {unfinished.length > 0 && (
          <button type="button" className="button button-secondary" onClick={() => void rollOver()}>
            Move {unfinished.length} unfinished to tomorrow
          </button>
        )}
        <button type="button" className="button button-primary" onClick={() => void save()}>Save</button>
      </div>
      {msg && <small className={styles.muted} role="status">{msg}</small>}
    </article>
  );
}
