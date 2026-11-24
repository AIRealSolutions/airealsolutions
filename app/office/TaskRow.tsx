"use client";

import styles from "./office.module.css";
import { BizTag, PriorityDot } from "./components";
import { minutes, officeToday, prettyDate, type Business, type Task } from "./lib/client";

export function TaskRow({
  task, business, onComplete, onReopen, onDue, onDrop, busy,
}: {
  task: Task;
  business?: Business;
  onComplete: (t: Task) => void;
  onReopen?: (t: Task) => void;
  onDue?: (t: Task, due: string | null) => void;
  onDrop?: (t: Task) => void;
  busy?: boolean;
}) {
  const done = task.status === "done";
  const overdue = !done && task.due_on && task.due_on < officeToday();
  return (
    <li className={`${styles.taskRow} ${done ? styles.taskDone : ""}`}>
      <input
        type="checkbox"
        checked={done}
        disabled={busy || task.status === "dropped"}
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onChange={() => (done ? onReopen?.(task) : onComplete(task))}
      />
      <div className={styles.taskMain}>
        <span className={styles.taskTitle}>
          <PriorityDot p={task.priority} /> {task.title}
          {task.recurrence !== "none" && <small className={styles.muted} title="Repeats"> ↻ {task.recurrence}</small>}
        </span>
        <span className={styles.taskMeta}>
          <BizTag business={business} />
          {onDue ? (
            <input
              type="date"
              className={`${styles.dateInput} ${overdue ? styles.overdue : ""}`}
              value={task.due_on || ""}
              aria-label="Due date"
              onChange={(e) => onDue(task, e.target.value || null)}
            />
          ) : (
            task.due_on && <small className={overdue ? styles.overdue : styles.muted}>{prettyDate(task.due_on)}</small>
          )}
          {task.estimate_min ? <small className={styles.muted}>{minutes(task.estimate_min)}</small> : null}
        </span>
      </div>
      {onDrop && !done && (
        <button type="button" className={styles.iconButton} title="Drop this task" aria-label={`Drop ${task.title}`} onClick={() => onDrop(task)}>✕</button>
      )}
    </li>
  );
}
