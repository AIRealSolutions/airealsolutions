"use client";
import { useEffect, useState } from "react";
import styles from "./connections.module.css";
import { api } from "./session";

type Platform = { provider: string; label: string; configured: boolean; ok: boolean; account: string | null; detail: string; envVar: string };
type Status = {
  user: { email: string | null };
  isAdmin: boolean;
  googleConfigured: boolean;
  google: { email: string | null; scopes: string[]; status: string; connectedAt: string } | null;
  platform: Platform[] | null;
};
type Mail = { id: string; from: string; subject: string; date: string; snippet: string };
type Ev = { id: string; summary: string; start: string; end: string; htmlLink: string; location?: string };
type Resource = { name: string; url: string | null; updated: string | null; extra?: string };

const fmt = (iso: string) => {
  const d = new Date(iso);
  return isNaN(+d) ? iso : d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
const hasScope = (s: Status["google"], part: string) => Boolean(s?.scopes.some((x) => x.includes(part)));

export default function ConnectionsPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    try {
      setStatus(await api<Status>("/api/integrations/status"));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load connections.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function connectGoogle() {
    setBusy("google");
    try {
      const { url } = await api<{ url: string }>("/api/integrations/google/start", { method: "POST" });
      location.href = url;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not start Google sign-in.");
      setBusy("");
    }
  }
  async function disconnectGoogle() {
    if (!confirm("Disconnect Google? The Factory will no longer be able to send email or book events for you.")) return;
    setBusy("google");
    try {
      await api("/api/integrations/google", { method: "DELETE" });
      setMsg("Google disconnected.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy("");
    }
  }

  if (!status) {
    return (
      <section className="section">
        <p>{msg || "Loading connections…"}</p>
        {msg && <a className="button button-primary" href="/login">Sign in</a>}
      </section>
    );
  }

  const g = status.google;
  return (
    <section className={`section ${styles.wrap}`}>
      {msg && <p className={styles.notice} role="status">{msg}</p>}

      <article className={styles.card}>
        <header className={styles.cardHead}>
          <div>
            <span className="product-tag">Your account</span>
            <h2>Google: Gmail &amp; Calendar</h2>
            <p>Connect your own Google account so the Factory can send email and book calendar events for you, such as showing confirmations, client follow-ups and project meetings.</p>
          </div>
          <Badge ok={g?.status === "connected"} label={g ? (g.status === "connected" ? "Connected" : "Needs reconnect") : "Not connected"} />
        </header>
        {!status.googleConfigured && (
          <p className={styles.warn}>Google sign-in is not set up on the server yet. An admin needs to add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and INTEGRATIONS_ENCRYPTION_KEY in Vercel.</p>
        )}
        {g && <p className={styles.meta}>Signed in as <strong>{g.email || "Google account"}</strong> since {fmt(g.connectedAt)}</p>}
        <div className={styles.actions}>
          <button className="button button-primary" onClick={() => void connectGoogle()} disabled={busy === "google" || !status.googleConfigured}>
            {g ? "Reconnect Google" : "Connect Google"}
          </button>
          {g && <button className="button button-secondary" onClick={() => void disconnectGoogle()} disabled={busy === "google"}>Disconnect</button>}
        </div>
        {g?.status === "connected" && (
          <div className={styles.split}>
            {hasScope(g, "gmail") && <Gmail />}
            {hasScope(g, "calendar") && <Calendar />}
          </div>
        )}
      </article>

      {status.isAdmin && status.platform && (
        <article className={styles.card}>
          <header className={styles.cardHead}>
            <div>
              <span className="product-tag">Factory platform · admin only</span>
              <h2>GitHub, Vercel &amp; Supabase</h2>
              <p>The accounts the Factory uses to create repositories, deploy sites and set up databases for customer projects. The keys stay on the server and are never sent to the browser.</p>
            </div>
          </header>
          <div className={styles.platformGrid}>
            {status.platform.map((p) => <PlatformCard key={p.provider} p={p} />)}
          </div>
        </article>
      )}
    </section>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`${styles.badge} ${ok ? styles.ok : styles.off}`}>{label}</span>;
}

function Gmail() {
  const [mail, setMail] = useState<Mail[] | null>(null);
  const [q, setQ] = useState("in:inbox");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  async function load(query = q) {
    setNote("");
    try {
      const d = await api<{ messages: Mail[] }>(`/api/integrations/gmail?q=${encodeURIComponent(query)}`);
      setMail(d.messages);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not load inbox.");
      setMail([]);
    }
  }
  useEffect(() => {
    void load("in:inbox");
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    setNote("");
    try {
      await api("/api/integrations/gmail", { method: "POST", body: JSON.stringify({ to, subject, text }) });
      setNote(`Sent to ${to}.`);
      setTo("");
      setSubject("");
      setText("");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.tool}>
      <h3>Gmail</h3>
      <form className={styles.form} onSubmit={send}>
        <input type="email" required placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
        <input required placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea required placeholder="Message" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="button button-primary" disabled={sending}>{sending ? "Sending…" : "Send from my Gmail"}</button>
      </form>
      {note && <p className={styles.meta}>{note}</p>}
      <form className={styles.searchRow} onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Gmail search" />
        <button className="button button-secondary">Search</button>
      </form>
      <ul className={styles.list}>
        {mail === null && <li>Loading…</li>}
        {mail?.length === 0 && <li>No messages.</li>}
        {mail?.map((m) => (
          <li key={m.id}>
            <strong>{m.subject || "(no subject)"}</strong>
            <small>{m.from.replace(/<.*>/, "").trim()} · {fmt(m.date)}</small>
            <span>{m.snippet}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Calendar() {
  const [events, setEvents] = useState<Ev[] | null>(null);
  const [summary, setSummary] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      setEvents((await api<{ events: Ev[] }>("/api/integrations/calendar")).events);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not load calendar.");
      setEvents([]);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setNote("");
    try {
      const { event } = await api<{ event: Ev }>("/api/integrations/calendar", {
        method: "POST",
        body: JSON.stringify({
          summary,
          start,
          end,
          location,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          attendees: attendees.split(/[,\s]+/).filter(Boolean),
        }),
      });
      setNote(`Booked “${event.summary}”.`);
      setSummary("");
      setLocation("");
      setAttendees("");
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.tool}>
      <h3>Google Calendar</h3>
      <form className={styles.form} onSubmit={create}>
        <input required placeholder="Event title (e.g. Showing: 123 Oak St)" value={summary} onChange={(e) => setSummary(e.target.value)} />
        <div className={styles.two}>
          <label>Start<input type="datetime-local" required value={start} onChange={(e) => { setStart(e.target.value); if (!end || end <= e.target.value) setEnd(e.target.value); }} /></label>
          <label>End<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <input placeholder="Location (optional)" value={location} onChange={(e) => setLocation(e.target.value)} />
        <input placeholder="Invite emails, comma separated (optional)" value={attendees} onChange={(e) => setAttendees(e.target.value)} />
        <button className="button button-primary" disabled={saving}>{saving ? "Booking…" : "Add to my calendar"}</button>
      </form>
      {note && <p className={styles.meta}>{note}</p>}
      <ul className={styles.list}>
        {events === null && <li>Loading…</li>}
        {events?.length === 0 && <li>No upcoming events.</li>}
        {events?.map((ev) => (
          <li key={ev.id}>
            <a href={ev.htmlLink} target="_blank" rel="noreferrer"><strong>{ev.summary}</strong></a>
            <small>{fmt(ev.start)}{ev.location ? ` · ${ev.location}` : ""}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlatformCard({ p }: { p: Platform }) {
  const [items, setItems] = useState<Resource[] | null>(null);
  const [err, setErr] = useState("");
  async function show() {
    if (items) return setItems(null);
    try {
      setItems((await api<{ items: Resource[] }>(`/api/integrations/platform?provider=${p.provider}`)).items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not list.");
    }
  }
  return (
    <div className={styles.tool}>
      <div className={styles.cardHead}>
        <h3>{p.label}</h3>
        <Badge ok={p.ok} label={p.ok ? "Connected" : p.configured ? "Error" : "Not set up"} />
      </div>
      {p.account && <p className={styles.meta}>Account: <strong>{p.account}</strong></p>}
      <p className={styles.meta}>{p.detail}</p>
      {p.ok && <button className="button button-secondary" onClick={() => void show()}>{items ? "Hide" : "Show list"}</button>}
      {err && <p className={styles.meta}>{err}</p>}
      {items && (
        <ul className={styles.list}>
          {items.length === 0 && <li>Nothing yet.</li>}
          {items.map((it) => (
            <li key={it.name}>
              {it.url ? <a href={it.url} target="_blank" rel="noreferrer"><strong>{it.name}</strong></a> : <strong>{it.name}</strong>}
              <small>{[it.extra, it.updated ? fmt(it.updated) : null].filter(Boolean).join(" · ")}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
