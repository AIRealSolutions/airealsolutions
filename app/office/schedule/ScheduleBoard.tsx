"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { BizTag, BusinessSelect, ErrorBox } from "../components";
import { useBusinesses } from "../useBusinesses";
import { api } from "../../factory/connections/session";
import {
  officeDelete, officeInsert, officeRest, officeToday, prettyDateTime, shiftDate,
  RECURRENCES, REMINDER_SELECT, TASK_SELECT, OFFICE_TZ, type Reminder, type Task,
} from "../lib/client";

type CalEvent = { id: string; day: string; summary: string; allDay: boolean; start: string; end: string; htmlLink: string; location: string | null };
type Block = { id: string; business_id: string | null; weekday: number; start_time: string; end_time: string; label: string | null };
type Entry = { key: string; start: string; end: string; title: string; kind: "event" | "block" | "reminder"; business_id: string | null; href?: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const isoDow = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const monday = (date: string) => shiftDate(date, 1 - isoDow(date));
const hhmm = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: OFFICE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const twelve = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`; };

export default function ScheduleBoard() {
  const { businesses, error: bizError } = useBusinesses();
  const today = officeToday();
  const [week, setWeek] = useState(monday(today));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [calNote, setCalNote] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [repeating, setRepeating] = useState<{ tasks: Task[]; reminders: Reminder[] }>({ tasks: [], reminders: [] });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const byId = useMemo(() => new Map(businesses.map((b) => [b.id, b])), [businesses]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDate(week, i)), [week]);

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    const end = shiftDate(week, 7);
    try {
      const [cal, b, t, r, rt, rr] = await Promise.all([
        api<{ events: CalEvent[]; note: string | null }>(`/api/office/schedule?start=${week}`).catch((e) => ({ events: [], note: e instanceof Error ? e.message : "Calendar unavailable." })),
        officeRest<Block[]>("office_time_blocks?select=id,business_id,weekday,start_time,end_time,label&order=weekday.asc,start_time.asc"),
        officeRest<Task[]>(`office_tasks?status=eq.todo&due_on=gte.${week}&due_on=lt.${end}&select=${TASK_SELECT}&order=priority.asc`),
        officeRest<Reminder[]>(`office_reminders?status=eq.pending&remind_at=gte.${encodeURIComponent(new Date(`${week}T00:00:00Z`).toISOString())}&remind_at=lt.${encodeURIComponent(new Date(`${end}T12:00:00Z`).toISOString())}&select=${REMINDER_SELECT}`),
        officeRest<Task[]>(`office_tasks?status=eq.todo&recurrence=neq.none&select=${TASK_SELECT}&order=title.asc`),
        officeRest<Reminder[]>(`office_reminders?status=eq.pending&recurrence=neq.none&select=${REMINDER_SELECT}&order=remind_at.asc`),
      ]);
      setEvents(cal.events);
      setCalNote(cal.note);
      setBlocks(b);
      setTasks(t);
      setReminders(r);
      setRepeating({ tasks: rt, reminders: rr });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the week.");
    } finally {
      setLoading(false);
    }
  }, [week]);
  useEffect(() => { void load(); }, [load]);

  const entriesFor = (day: string): Entry[] => {
    const dow = isoDow(day);
    const list: Entry[] = [
      ...events.filter((e) => e.day === day && !e.allDay).map((e) => ({ key: `e${e.id}`, start: e.start, end: e.end, title: e.summary, kind: "event" as const, business_id: null, href: e.htmlLink })),
      ...blocks.filter((b) => b.weekday === dow).map((b) => ({
        key: `b${b.id}`, start: b.start_time.slice(0, 5), end: b.end_time.slice(0, 5),
        title: b.label || (b.business_id ? byId.get(b.business_id)?.name : null) || "Block", kind: "block" as const, business_id: b.business_id,
      })),
      ...reminders.filter((r) => new Intl.DateTimeFormat("en-CA", { timeZone: OFFICE_TZ }).format(new Date(r.remind_at)) === day)
        .map((r) => ({ key: `r${r.id}`, start: hhmm(r.remind_at), end: "", title: r.title, kind: "reminder" as const, business_id: r.business_id })),
    ];
    return list.sort((a, b) => a.start.localeCompare(b.start));
  };

  const weekLabel = `${new Date(`${week}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} – ${new Date(`${shiftDate(week, 6)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={`${styles.pageHeader} ${styles.headerRow}`}>
        <div>
          <span className="product-tag">Run</span>
          <h1>Schedule</h1>
          <p>Your Google Calendar, standing time blocks for each business, reminders and tasks due, one week at a time.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="button button-secondary" onClick={() => setWeek(shiftDate(week, -7))} aria-label="Previous week">←</button>
          <button className="button button-secondary" onClick={() => setWeek(monday(today))} disabled={week === monday(today)}>This week</button>
          <button className="button button-secondary" onClick={() => setWeek(shiftDate(week, 7))} aria-label="Next week">→</button>
        </div>
      </header>
      <ErrorBox message={bizError || error} />
      {calNote && <div className={styles.note}>Calendar not shown: {calNote} <a className={styles.smallLink} href="/factory/connections">Connections →</a></div>}

      <h2 className={styles.sectionTitle}>{weekLabel}</h2>
      {loading && <p className={styles.muted}>Loading…</p>}
      <div className={styles.week}>
        {days.map((day, i) => {
          const allDay = events.filter((e) => e.day === day && e.allDay);
          const due = tasks.filter((t) => t.due_on === day);
          const entries = entriesFor(day);
          return (
            <div key={day} className={`${styles.weekDay} ${day === today ? styles.weekToday : ""}`}>
              <div className={styles.weekDayHead}>
                <strong>{DAYS[i]}</strong>
                <span>{new Date(`${day}T12:00:00Z`).getUTCDate()}</span>
              </div>
              {allDay.map((e) => <div key={e.id} className={styles.allDay}>{e.summary}</div>)}
              <ul className={styles.weekEntries}>
                {entries.map((e) => (
                  <li key={e.key} className={styles[`entry_${e.kind}`]}>
                    <time>{twelve(e.start)}{e.end ? `–${twelve(e.end)}` : ""}</time>
                    {e.href ? <a href={e.href} target="_blank" rel="noopener noreferrer">{e.title}</a> : <span>{e.kind === "reminder" ? `⏰ ${e.title}` : e.title}</span>}
                  </li>
                ))}
              </ul>
              {due.length > 0 && (
                <div className={styles.weekDue}>
                  <small>{due.length} task{due.length === 1 ? "" : "s"} due</small>
                  <ul>{due.slice(0, 4).map((t) => <li key={t.id}>{t.title}</li>)}{due.length > 4 && <li>+{due.length - 4} more</li>}</ul>
                </div>
              )}
              {!entries.length && !allDay.length && !due.length && <small className={styles.muted}>Open</small>}
            </div>
          );
        })}
      </div>

      <div className={styles.twoCol}>
        <TimeBlocks businesses={businesses} blocks={blocks} onChanged={load} onError={setError} />
        <article className={styles.card}>
          <h2>Repeating duties</h2>
          <p className={styles.muted}>Tasks and reminders that come back on their own. Add them on Tasks or Reminders with “Repeats”.</p>
          {repeating.tasks.length + repeating.reminders.length === 0 && <p className={styles.muted}>None yet.</p>}
          <ul className={styles.plainList}>
            {repeating.tasks.map((t) => (
              <li key={t.id}><strong>{t.title}</strong><span className={styles.taskMeta}><small className={styles.muted}>Task · {RECURRENCES.find((r) => r.value === t.recurrence)?.label}{t.due_on ? ` · next ${t.due_on}` : ""}</small><BizTag business={t.business_id ? byId.get(t.business_id) : undefined} /></span></li>
            ))}
            {repeating.reminders.map((r) => (
              <li key={r.id}><strong>{r.title}</strong><span className={styles.taskMeta}><small className={styles.muted}>Reminder · {RECURRENCES.find((x) => x.value === r.recurrence)?.label} · next {prettyDateTime(r.remind_at)}</small><BizTag business={r.business_id ? byId.get(r.business_id) : undefined} /></span></li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function TimeBlocks({ businesses, blocks, onChanged, onError }: {
  businesses: ReturnType<typeof useBusinesses>["businesses"]; blocks: Block[]; onChanged: () => Promise<void>; onError: (m: string) => void;
}) {
  const [days, setDays] = useState<number[]>([1, 3]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [business, setBusiness] = useState("");
  const [label, setLabel] = useState("");
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!days.length) return onError("Pick at least one day.");
    if (end <= start) return onError("End must be after start.");
    try {
      for (const d of days) await officeInsert("office_time_blocks", { weekday: d, start_time: start, end_time: end, business_id: business || null, label: label.trim() || null });
      setLabel("");
      await onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not add the block.");
    }
  }
  return (
    <article className={styles.card}>
      <h2>Time blocks</h2>
      <p className={styles.muted}>Standing hours for each business. The daily planner puts that business’s work inside its block.</p>
      <ul className={styles.plainList}>
        {blocks.map((b) => (
          <li key={b.id} className={styles.reminderRow}>
            <div>
              <strong>{DAYS[b.weekday - 1]} {twelve(b.start_time.slice(0, 5))}–{twelve(b.end_time.slice(0, 5))}</strong>
              <span className={styles.taskMeta}><BizTag business={businesses.find((x) => x.id === b.business_id)} />{b.label && <small className={styles.muted}>{b.label}</small>}</span>
            </div>
            <button type="button" className={styles.linkButton} onClick={async () => { await officeDelete("office_time_blocks", b.id); await onChanged(); }}>Remove</button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className={styles.blockForm}>
        <fieldset className={styles.dayPicker}>
          <legend>Days</legend>
          {DAYS.map((d, i) => (
            <label key={d}><input type="checkbox" checked={days.includes(i + 1)} onChange={(e) => setDays((v) => (e.target.checked ? [...v, i + 1] : v.filter((x) => x !== i + 1)))} />{d}</label>
          ))}
        </fieldset>
        <div className={styles.formGrid}>
          <label className={styles.field}>From<input type="time" value={start} onChange={(e) => setStart(e.target.value)} required /></label>
          <label className={styles.field}>To<input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required /></label>
          <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} noneLabel="Any (general)" />
          <label className={styles.field}>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Deep work" /></label>
        </div>
        <div className={styles.rowEnd}><button className="button button-primary" type="submit">Add block</button></div>
      </form>
    </article>
  );
}
