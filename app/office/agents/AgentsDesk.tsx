"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { officeRest, officeToday, prettyDateTime } from "../lib/client";

type Run = {
  id: string; agent: string; model: string | null; ok: boolean; error: string | null; input_tokens: number; output_tokens: number;
  cost_usd: number; fell_back: boolean; duration_ms: number | null; subject: string | null; created_at: string;
};
type Waiting = { key: string; icon: string; label: string; hint: string; href: string; count: number };

/** Every agent in the Office: what it does and where its work waits for you. */
const AGENTS: [string, string, string][] = [
  ["daily-planner", "Daily Planner", "Builds today's 3 goals and time-blocked agenda. You re-plan or edit on Today."],
  ["quick-capture", "Quick Capture", "Turns a typed thought into a task, reminder or note."],
  ["note-to-tasks", "Note → Tasks", "Pulls tasks out of a note; you pick which to keep."],
  ["feed-ranker", "Feed Ranker", "Scores news for each business and suggests an action you accept or dismiss."],
  ["weekly-review", "Weekly Review", "Sunday summary with proposed goals you apply or skip."],
  ["receipt-reader", "Receipt Reader", "Reads a receipt photo into an expense you confirm."],
  ["bookkeeper", "Bookkeeper", "Suggests a category for bank transactions; nothing posts until you approve."],
  ["follow-up", "Follow-up Writer", "Drafts CRM emails; you edit and press Send."],
  ["plan-drafter", "Plan Drafter", "Drafts business, marketing, launch and licensing plans as new versions."],
  ["plan-reviewer", "Plan Reviewer", "Scores a plan and suggests rewrites you apply one by one."],
  ["advisor", "Advisor", "Answers questions about a business with one-click tasks you choose to add."],
  ["content-ideas", "Content Ideas", "Suggests posts and videos; you add the ones you like."],
  ["content-writer", "Content Writer", "Writes scripts and captions; posting waits for your Publish."],
];
const name = (a: string) => AGENTS.find(([k]) => k === a)?.[1] || a;
const money = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

async function count(path: string): Promise<number | null> {
  try { return (await officeRest<unknown[]>(`${path}${path.includes("?") ? "&" : "?"}select=id&limit=100`)).length; } catch { return null; }
}

export default function AgentsDesk() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [waiting, setWaiting] = useState<Waiting[]>([]);
  const [budget, setBudget] = useState<number | null>(null);
  const [ai, setAi] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const [agentFilter, setAgentFilter] = useState("");

  useEffect(() => {
    const since = new Date(Date.now() - 31 * 86400_000).toISOString();
    officeRest<Run[]>(`office_agent_runs?created_at=gte.${encodeURIComponent(since)}&select=id,agent,model,ok,error,input_tokens,output_tokens,cost_usd,fell_back,duration_ms,subject,created_at&order=created_at.desc&limit=2000`)
      .then(setRuns, (e) => { if (e instanceof Error && /not in the database/i.test(e.message)) setMissing(true); else setError(e instanceof Error ? e.message : "Could not load agent runs."); });
    officeRest<number | null>("rpc/office_ai_budget", { method: "POST", body: "{}" }).then((b) => setBudget(b == null ? null : Number(b)), () => setBudget(null));
    fetch("/api/office/plan").then((r) => r.json()).then((d) => setAi(Boolean(d.aiConfigured)), () => setAi(null));
    const today = officeToday();
    const nowIso = encodeURIComponent(new Date().toISOString());
    const weekAgo = encodeURIComponent(new Date(Date.now() - 7 * 86400_000).toISOString());
    const checks: (Omit<Waiting, "count"> & { path: string })[] = [
      { key: "books", icon: "🧾", label: "Bank transactions with a suggested category", hint: "Approve or change each in Accounting → Banking.", href: "/office/accounting", path: "acct_bank_txns?status=eq.new&suggested_account_id=not.is.null" },
      { key: "posts", icon: "⚠️", label: "Posts that failed to go out", hint: "Open the piece to see why, then Retry.", href: "/office/studio", path: "office_publications?status=eq.failed" },
      { key: "ready", icon: "🎬", label: "Content ready but not scheduled", hint: "Pick channels and a time, or publish now.", href: "/office/studio", path: "office_content?status=eq.ready&scheduled_at=is.null" },
      { key: "deals", icon: "🤝", label: "Deal follow-ups due", hint: "Draft the follow-up with AI and send it.", href: "/office/crm", path: `office_deals?status=eq.open&next_step_on=lte.${today}` },
      { key: "feed", icon: "📰", label: "News with a suggested action", hint: "Accept or dismiss each suggestion.", href: "/office/feed", path: "office_feed_items?status=eq.new&score=gte.70&suggested_action=not.is.null" },
      { key: "ready-items", icon: "✅", label: "Checklist items the AI proposed this week", hint: "Keep, edit or mark not applicable.", href: "/office/incubator", path: `office_readiness_items?source=eq.ai&status=eq.todo&created_at=gte.${weekAgo}` },
      { key: "reminders", icon: "⏰", label: "Reminders due", hint: "Done, snooze or turn into a task.", href: "/office/reminders", path: `office_reminders?status=eq.pending&remind_at=lte.${nowIso}` },
      { key: "tasks", icon: "📌", label: "Overdue tasks", hint: "Reschedule or finish.", href: "/office/tasks", path: `office_tasks?status=eq.todo&due_on=lt.${today}` },
    ];
    Promise.all(checks.map(async (c) => ({ ...c, count: await count(c.path) }))).then((rows) => setWaiting(rows.filter((r) => r.count).map((r) => ({ ...r, count: r.count! }))));
  }, []);

  const stats = useMemo(() => {
    const now = Date.now();
    const sum = (days: number) => runs.filter((r) => now - new Date(r.created_at).getTime() < days * 86400_000).reduce((s, r) => s + Number(r.cost_usd), 0);
    const monthStart = `${officeToday().slice(0, 7)}-01`;
    const month = runs.filter((r) => r.created_at.slice(0, 10) >= monthStart).reduce((s, r) => s + Number(r.cost_usd), 0);
    const byAgent = new Map<string, { runs: number; failed: number; cost: number; ms: number; fell: number; last: string }>();
    for (const r of runs) {
      const a = byAgent.get(r.agent) || { runs: 0, failed: 0, cost: 0, ms: 0, fell: 0, last: r.created_at };
      a.runs++; if (!r.ok) a.failed++; a.cost += Number(r.cost_usd); a.ms += r.duration_ms || 0; if (r.fell_back) a.fell++;
      byAgent.set(r.agent, a);
    }
    return { day: sum(1), week: sum(7), month, failed: runs.filter((r) => !r.ok).length, byAgent };
  }, [runs]);

  const shown = runs.filter((r) => !agentFilter || r.agent === agentFilter).slice(0, 60);
  const pct = budget ? Math.min(100, (stats.month / budget) * 100) : 0;

  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Admin</span>
        <h1>Agents Desk</h1>
        <p>What the Office&apos;s AI agents did, what it cost, and everything waiting on your approval. Agents only draft and suggest: nothing is sent, posted or booked until you say so.</p>
      </header>
      <ErrorBox message={error} />
      {ai === false && <div className={styles.note}>AI is not switched on yet. Add ANTHROPIC_API_KEY in Vercel; until then the planner and review use their quick (non-AI) versions.</div>}
      {missing && <div className={styles.note}>Run docs/office-phase8.sql in Supabase to start logging agent runs.</div>}

      <article className={styles.card}>
        <h2>Waiting on you</h2>
        {waiting.length === 0 ? <p className={styles.muted}>Nothing waiting. 🎉</p> : (
          <ul className={styles.queue}>
            {waiting.map((w) => (
              <li key={w.key}><a href={w.href}>
                <span aria-hidden="true">{w.icon}</span>
                <span><strong>{w.label}</strong><br /><small className={styles.muted}>{w.hint}</small></span>
                <span className={styles.queueCount}>{w.count >= 100 ? "99+" : w.count}</span>
              </a></li>
            ))}
          </ul>
        )}
      </article>

      <div className={styles.deskGrid} style={{ marginTop: 16 }}>
        <article className={`${styles.card} ${styles.deskStat}`}><small className={styles.muted}>Today</small><strong>{money(stats.day)}</strong></article>
        <article className={`${styles.card} ${styles.deskStat}`}><small className={styles.muted}>Last 7 days</small><strong>{money(stats.week)}</strong></article>
        <article className={`${styles.card} ${styles.deskStat}`}>
          <small className={styles.muted}>This month{budget ? ` of ${money(budget)} budget` : ""}</small><strong>{money(stats.month)}</strong>
          {budget ? <div className={styles.meter} aria-label={`${pct.toFixed(0)}% of budget`}><span style={{ width: `${pct}%` }} data-over={pct >= 100} /></div> : <a className={styles.smallLink} href="/office/settings">Set a monthly budget</a>}
        </article>
        <article className={`${styles.card} ${styles.deskStat}`}><small className={styles.muted}>Runs (30 days)</small><strong>{runs.length}</strong>{stats.failed > 0 && <small style={{ color: "#991b1b" }}>{stats.failed} failed</small>}</article>
      </div>

      <article className={styles.card}>
        <h2>The agents</h2>
        <div className={styles.tableWrap}>
          <table className={styles.runTable}>
            <thead><tr><th>Agent</th><th>What it does</th><th className={styles.num}>Runs</th><th className={styles.num}>Failed</th><th className={styles.num}>Avg time</th><th className={styles.num}>Cost (30d)</th></tr></thead>
            <tbody>
              {AGENTS.map(([k, label, about]) => {
                const a = stats.byAgent.get(k);
                return (
                  <tr key={k}>
                    <td><button type="button" className={styles.linkButton} onClick={() => setAgentFilter(agentFilter === k ? "" : k)}>{label}</button></td>
                    <td className={styles.wrap}><small className={styles.muted}>{about}</small></td>
                    <td className={styles.num}>{a?.runs ?? 0}</td>
                    <td className={styles.num}>{a?.failed || ""}</td>
                    <td className={styles.num}>{a?.runs ? `${Math.round(a.ms / a.runs / 1000)}s` : ""}</td>
                    <td className={styles.num}>{a ? money(a.cost) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </article>

      <article className={styles.card} style={{ marginTop: 16 }}>
        <div className={styles.cardHead}><h2>Recent runs{agentFilter && ` · ${name(agentFilter)}`}</h2>{agentFilter && <button type="button" className={styles.linkButton} onClick={() => setAgentFilter("")}>Show all</button>}</div>
        {shown.length === 0 ? <p className={styles.muted}>No runs yet.</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.runTable}>
              <thead><tr><th>When</th><th>Agent</th><th>On</th><th>Model</th><th className={styles.num}>Tokens in / out</th><th className={styles.num}>Cost</th><th>Result</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td>{prettyDateTime(r.created_at)}</td>
                    <td>{name(r.agent)}</td>
                    <td className={styles.wrap}>{r.subject || ""}</td>
                    <td>{r.model || ""}{r.fell_back && <small className={styles.muted}> (fallback)</small>}</td>
                    <td className={styles.num}>{r.input_tokens.toLocaleString()} / {r.output_tokens.toLocaleString()}</td>
                    <td className={styles.num}>${Number(r.cost_usd).toFixed(3)}</td>
                    <td className={styles.wrap}>{r.ok ? "✓" : <span style={{ color: "#991b1b" }}>{r.error || "Failed"}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <small className={styles.muted}>Costs are estimates at list prices; check the Anthropic Console for the bill.</small>
      </article>
    </section>
  );
}
