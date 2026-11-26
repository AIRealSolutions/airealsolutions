"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { officeDelete, officeInsert, officePatch, officeRest, prettyDateTime } from "../lib/client";

type Member = { id: string; email: string; name: string | null; role: "assistant" | "cpa"; active: boolean; last_seen_at: string | null; created_at: string };

const ROLES = {
  assistant: { label: "Assistant", sees: "Today, Businesses, Incubator, Goals, Tasks, Reminders, Feed, Schedule, CRM, Content Studio, Library and Notebook. Can publish to connected channels and use the AI agents. No money, no Factory, no connections, no team or settings." },
  cpa: { label: "CPA", sees: "Invoicing & Billing, Expenses & Bills and Accounting, read-only: invoices, payments, bills, expenses, the journal, reports and receipts. Nothing else, and can't change the books." },
} as const;

export default function TeamBoard() {
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ email: "", name: "", role: "assistant" as Member["role"] });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try { setMembers(await officeRest<Member[]>("office_members?select=*&order=created_at.asc")); }
    catch (e) { if (e instanceof Error && /not in the database/i.test(e.message)) setMissing(true); else setError(e instanceof Error ? e.message : "Could not load the team."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    const email = form.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError("Enter a valid email address.");
    try {
      await officeInsert("office_members", { email, name: form.name.trim() || null, role: form.role });
      setForm({ email: "", name: "", role: form.role });
      setMsg(`Added ${email} as ${ROLES[form.role].label}. Send them the invitation below.`);
      await load();
    } catch (e2) { setError(e2 instanceof Error && /duplicate|unique/i.test(e2.message) ? "That email is already on the team." : e2 instanceof Error ? e2.message : "Could not add them."); }
  }
  const invite = (m: Member) => `Hi${m.name ? ` ${m.name.split(" ")[0]}` : ""}, you have ${ROLES[m.role].label} access to the AI Real Solutions Office. Go to https://airealsolutions.com/login, create an account (or sign in) with ${m.email}, then open https://airealsolutions.com/office.`;

  if (missing) return <section className={styles.page}><header className={styles.pageHeader}><span className="product-tag">Admin</span><h1>Team</h1></header><p className={styles.muted}>Run docs/office-phase8.sql in Supabase to add team members.</p></section>;
  return (
    <section className={`${styles.page} ${styles.pageWide}`}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Admin</span>
        <h1>Team</h1>
        <p>Give an assistant or your CPA their own sign-in. Each role sees only its part of the Office; the database enforces it, not just the menu.</p>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <form className={`${styles.card} ${styles.addForm}`} onSubmit={(e) => void add(e)}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@example.com" /></label>
          <label className={styles.field}>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Optional" /></label>
          <label className={styles.field}>Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Member["role"] })}><option value="assistant">Assistant</option><option value="cpa">CPA</option></select>
          </label>
          <button className="button button-primary" style={{ alignSelf: "end" }}>Add to team</button>
        </div>
        <small className={styles.muted}><strong>{ROLES[form.role].label}</strong> sees: {ROLES[form.role].sees}</small>
      </form>

      <article className={styles.card} style={{ marginTop: 16 }}>
        <h2>People</h2>
        <ul className={styles.channelList}>
          <li className={styles.channelRow}><span className={styles.channelIcon}>★</span><div><strong>You</strong><div><small className={styles.muted}>Owner · everything</small></div></div><span /></li>
          {members.map((m) => (
            <li key={m.id} className={styles.channelRow} style={m.active ? undefined : { opacity: 0.6 }}>
              <span className={styles.channelIcon}>{m.role === "cpa" ? "🧮" : "🧑‍💼"}</span>
              <div style={{ minWidth: 0 }}>
                <strong>{m.name || m.email}</strong> <span className={styles.roleBadge}>{ROLES[m.role].label}</span>
                <div><small className={styles.muted}>{m.email} · {m.last_seen_at ? `last in ${prettyDateTime(m.last_seen_at)}` : "hasn't signed in yet"}{m.active ? "" : " · paused"}</small></div>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.linkButton} onClick={() => { void navigator.clipboard?.writeText(invite(m)); setMsg(`Invitation for ${m.email} copied. Paste it into an email or text.`); }}>Copy invitation</button>
                <select aria-label={`Role for ${m.email}`} value={m.role} onChange={async (e) => { await officePatch("office_members", `id=eq.${m.id}`, { role: e.target.value }); await load(); }}>
                  <option value="assistant">Assistant</option><option value="cpa">CPA</option>
                </select>
                <button type="button" className={styles.linkButton} onClick={async () => { await officePatch("office_members", `id=eq.${m.id}`, { active: !m.active }); await load(); }}>{m.active ? "Pause" : "Resume"}</button>
                <button type="button" className={styles.linkButton} onClick={async () => { if (!window.confirm(`Remove ${m.email} from the team? They lose Office access right away.`)) return; await officeDelete("office_members", m.id); await load(); }}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
        {members.length === 0 && <p className={styles.muted}>Just you so far.</p>}
        <small className={styles.muted}>Pausing or removing someone takes effect on their next click. Their past work stays.</small>
      </article>
    </section>
  );
}
