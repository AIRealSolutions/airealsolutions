"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { api } from "../../factory/connections/session";
import { officeInsert, officeRest, prettyDateTime } from "../lib/client";
import { KIND_ICON, type Activity, type Contact } from "./types";

type Mail = { id: string; from: string; subject: string; date: string; snippet: string };

/** Activity timeline + quick log + Gmail history + AI follow-up composer. */
export function Timeline({ contact, dealId, companyId, onError }: { contact: Contact | null; dealId?: string; companyId?: string | null; onError: (m: string) => void }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [kind, setKind] = useState<Activity["kind"]>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mail, setMail] = useState<Mail[] | null>(null);
  const [mailNote, setMailNote] = useState("");
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const filter = dealId ? `deal_id=eq.${dealId}` : contact ? `contact_id=eq.${contact.id}` : "";
    if (!filter) return;
    try { setItems(await officeRest<Activity[]>(`office_activities?${filter}&select=id,contact_id,company_id,deal_id,kind,direction,subject,body,occurred_at&order=occurred_at.desc&limit=200`)); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not load the timeline."); }
  }, [dealId, contact, onError]);
  useEffect(() => { void load(); }, [load]);

  async function log(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() && !body.trim()) return;
    try {
      await officeInsert("office_activities", { contact_id: contact?.id ?? null, company_id: companyId ?? contact?.company_id ?? null, deal_id: dealId ?? null, kind, subject: subject.trim() || null, body: body.trim() || null, direction: kind === "note" ? null : "out" });
      setSubject(""); setBody("");
      await load();
    } catch (err) { onError(err instanceof Error ? err.message : "Could not save."); }
  }

  async function loadMail() {
    if (!contact?.email) return;
    setBusy("mail");
    setMailNote("");
    try { setMail((await api<{ messages: Mail[] }>(`/api/office/crm/gmail?email=${encodeURIComponent(contact.email)}`)).messages); }
    catch (e) { setMailNote(e instanceof Error ? e.message : "Gmail could not be read."); }
    finally { setBusy(""); }
  }
  async function saveMail(m: Mail) {
    try {
      const mine = !m.from.toLowerCase().includes((contact?.email || "").toLowerCase());
      await officeRest("office_activities?on_conflict=external_ref", {
        method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ contact_id: contact?.id, company_id: contact?.company_id ?? null, deal_id: dealId ?? null, kind: "email", direction: mine ? "out" : "in", subject: m.subject.slice(0, 300), body: m.snippet, occurred_at: new Date(m.date).toISOString(), external_ref: `gmail:${m.id}` }),
      });
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not save the email."); }
  }

  async function makeDraft() {
    if (!contact) return;
    setBusy("draft");
    try { setDraft(await api<{ subject: string; body: string }>("/api/office/crm/draft", { method: "POST", body: JSON.stringify({ contact_id: contact.id, deal_id: dealId }) })); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not draft."); }
    finally { setBusy(""); }
  }
  async function send() {
    if (!contact || !draft) return;
    if (!window.confirm(`Send this email to ${contact.email} from your Gmail?`)) return;
    setBusy("send");
    try {
      await api("/api/office/crm/send", { method: "POST", body: JSON.stringify({ contact_id: contact.id, deal_id: dealId, subject: draft.subject, body: draft.body }) });
      setDraft(null);
      await load();
    } catch (e) { onError(e instanceof Error ? e.message : "Could not send."); }
    finally { setBusy(""); }
  }

  return (
    <>
      <article className={styles.card}>
        <div className={styles.cardHead}>
          <h2>Follow-up email</h2>
          {contact?.email && !draft && <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void makeDraft()}>{busy === "draft" ? "Drafting…" : "Draft with AI"}</button>}
        </div>
        {!contact?.email && <p className={styles.muted}>Add an email address to this contact to draft and send follow-ups.</p>}
        {contact?.email && !draft && <p className={styles.muted}>The Follow-up Agent reads this timeline and drafts a short email. You edit it, then send from your Gmail.</p>}
        {draft && (
          <>
            <label className={styles.field}>Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
            <label className={styles.field}>Message<textarea rows={9} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
            <div className={styles.rowEnd}>
              <button type="button" className={styles.linkButton} onClick={() => setDraft(null)}>Discard</button>
              <button type="button" className={styles.linkButton} onClick={() => void navigator.clipboard?.writeText(`${draft.subject}\n\n${draft.body}`)}>Copy</button>
              <button type="button" className="button button-primary" disabled={!!busy} onClick={() => void send()}>{busy === "send" ? "Sending…" : `Send to ${contact?.email}`}</button>
            </div>
          </>
        )}
      </article>

      <article className={styles.card}>
        <h2>Timeline</h2>
        <form onSubmit={log} className={styles.formGrid4}>
          <label className={styles.field}>Log
            <select value={kind} onChange={(e) => setKind(e.target.value as Activity["kind"])}>
              <option value="note">Note</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="email">Email (sent elsewhere)</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.span2}`}>Summary<input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Discovery call: wants mapping for 3 cemeteries" /></label>
          <div className={styles.rowEnd} style={{ alignSelf: "end" }}><button className="button button-primary" type="submit">Log</button></div>
          <label className={`${styles.field}`} style={{ gridColumn: "1 / -1" }}><span className={styles.srOnly}>Details</span><textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Details (optional)" /></label>
        </form>
        <ul className={styles.timeline}>
          {items.length === 0 && <li className={styles.muted}>Nothing logged yet.</li>}
          {items.map((a) => (
            <li key={a.id}>
              <span className={styles.timelineIcon} aria-hidden="true">{KIND_ICON[a.kind]}</span>
              <div>
                <strong>{a.subject || a.kind}</strong>
                <small className={styles.muted}>{prettyDateTime(a.occurred_at)}{a.direction ? ` · ${a.direction === "in" ? "from them" : "from you"}` : ""}</small>
                {a.body && <p className={styles.timelineBody}>{a.body}</p>}
              </div>
            </li>
          ))}
        </ul>
      </article>

      {contact?.email && (
        <article className={styles.card}>
          <div className={styles.cardHead}>
            <h2>Gmail</h2>
            <button type="button" className="button button-secondary" disabled={!!busy} onClick={() => void loadMail()}>{busy === "mail" ? "Loading…" : mail ? "Refresh" : "Show emails"}</button>
          </div>
          {mailNote && <small className={styles.overdue}>{mailNote}{/connect/i.test(mailNote) ? " (Factory → Connections)" : ""}</small>}
          {mail && mail.length === 0 && <p className={styles.muted}>No emails with {contact.email}.</p>}
          <ul className={styles.plainList}>
            {mail?.map((m) => (
              <li key={m.id} className={styles.reminderRow}>
                <div><strong>{m.subject || "(no subject)"}</strong><small className={styles.muted}>{m.from} · {m.date}</small><small className={styles.muted}>{m.snippet}</small></div>
                <button type="button" className={styles.linkButton} onClick={() => void saveMail(m)}>Add to timeline</button>
              </li>
            ))}
          </ul>
        </article>
      )}
    </>
  );
}
