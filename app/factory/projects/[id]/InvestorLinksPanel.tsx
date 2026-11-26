"use client";
// Private investor links for the instant preview: one link per person, optional PIN, expiry,
// what they may see (summary, numbers), and who opened what.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { factoryToken } from "../../connections/session";

const URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";

type Invite = {
  id: string;
  token: string;
  label: string;
  has_pin: boolean;
  show_summary: boolean;
  show_numbers: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  pin_locked_until: string | null;
  view_count: number;
  notify_owner: boolean;
  last_alerted_at: string | null;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
};
type View = { id: number; invite_id: string | null; visitor: string | null; path: string; created_at: string };

async function rest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await factoryToken();
  if (!token) throw new Error("Sign in to the Factory first.");
  const r = await fetch(URL + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: KEY, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(d?.message || "Factory request failed.");
  return d as T;
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const COLS = "id,token,label,has_pin,show_summary,show_numbers,expires_at,revoked_at,pin_locked_until,view_count,notify_owner,last_alerted_at,first_viewed_at,last_viewed_at,created_at";

export default function InvestorLinksPanel({ projectId, projectSlug }: { projectId: string; projectSlug: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [views, setViews] = useState<View[]>([]);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [fresh, setFresh] = useState<{ link: string; pin: string } | null>(null);
  const origin = typeof window === "undefined" ? "https://airealsolutions.com" : window.location.origin;
  const linkFor = (token: string) => `${origin}/preview/${projectSlug}?invite=${encodeURIComponent(token)}`;

  const load = useCallback(async () => {
    try {
      const [inv, vw] = await Promise.all([
        rest<Invite[]>(`factory_preview_invites?project_id=eq.${projectId}&select=${COLS}&order=created_at.desc&limit=50`),
        rest<View[]>(`factory_preview_views?project_id=eq.${projectId}&select=id,invite_id,visitor,path,created_at&order=created_at.desc&limit=25`),
      ]);
      setInvites(inv);
      setViews(vw);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load investor links.");
    }
  }, [projectId]);
  useEffect(() => void load(), [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const pin = String(fd.get("pin") || "").trim();
    const days = Number(fd.get("days") || 30);
    setBusy("create");
    setMsg("");
    try {
      const r = await rest<{ id: string; token: string }>("rpc/factory_preview_invite_create", {
        method: "POST",
        body: JSON.stringify({
          p_project: projectId,
          p_label: String(fd.get("label") || ""),
          p_pin: pin || null,
          p_days: days > 0 ? days : null,
          p_show_summary: fd.get("summary") === "on",
          p_show_numbers: fd.get("numbers") === "on",
        }),
      });
      setFresh({ link: linkFor(r.token), pin });
      form.reset();
      await load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Could not create the link.");
    } finally {
      setBusy("");
    }
  }

  async function update(inv: Invite, patch: Partial<Invite>, done: string) {
    setBusy(inv.id);
    try {
      await rest(`factory_preview_invites?id=eq.${inv.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
      setMsg(done);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change the link.");
    } finally {
      setBusy("");
    }
  }

  async function setPin(inv: Invite) {
    const pin = window.prompt(`New PIN for ${inv.label} (4–8 digits). Leave empty to remove the PIN.`, "");
    if (pin === null) return;
    setBusy(inv.id);
    try {
      await rest("rpc/factory_preview_invite_set_pin", { method: "POST", body: JSON.stringify({ p_invite: inv.id, p_pin: pin.trim() || null }) });
      setMsg(pin.trim() ? `PIN changed for ${inv.label}. Send it to them separately from the link.` : `PIN removed for ${inv.label}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change the PIN.");
    } finally {
      setBusy("");
    }
  }

  const copy = (text: string, what: string) => void navigator.clipboard?.writeText(text).then(() => setMsg(`${what} copied.`));
  const labelOf = (id: string | null) => (id ? invites.find((i) => i.id === id)?.label || "Old link" : "Public link");
  const active = (i: Invite) => !i.revoked_at && (!i.expires_at || new Date(i.expires_at) > new Date());

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid #e2e2e2", paddingTop: 20 }}>
      <h3>Investor links</h3>
      <p>
        <small>
          A private link for each person. It works even while public sharing is off, always shows the approved version, and you can see when they open it. Add a PIN for a second lock and send it separately. You get an email the first time each link is opened (then at most every 12 hours).
        </small>
      </p>

      <form onSubmit={(e) => void create(e)} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", alignItems: "end" }}>
        <label style={field}>
          <span>Who is it for?</span>
          <input name="label" required maxLength={120} placeholder="Jane Doe, Acme Capital" style={input} />
        </label>
        <label style={field}>
          <span>PIN (optional)</span>
          <input name="pin" inputMode="numeric" pattern="[0-9]{4,8}" maxLength={8} placeholder="4–8 digits" style={input} />
        </label>
        <label style={field}>
          <span>Link lasts</span>
          <select name="days" defaultValue="30" style={input}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
          </select>
        </label>
        <span style={{ display: "grid", gap: 4 }}>
          <label>
            <input type="checkbox" name="summary" defaultChecked /> Investor summary page
          </label>
          <label>
            <input type="checkbox" name="numbers" /> Include pricing and costs
          </label>
        </span>
        <button className="button button-primary" disabled={!!busy}>
          {busy === "create" ? "Creating…" : "Create link"}
        </button>
      </form>

      {fresh && (
        <div style={{ marginTop: 14, padding: 14, borderRadius: 12, background: "#ecfdf3", border: "1px solid #abefc6", display: "grid", gap: 8 }}>
          <strong>Link ready</strong>
          <code style={{ wordBreak: "break-all" }}>{fresh.link}</code>
          {fresh.pin && <span>PIN: <b>{fresh.pin}</b> — send it separately (text or a call), not in the same email.</span>}
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="button button-secondary" onClick={() => copy(fresh.link, "Link")}>Copy link</button>
            <button className="button button-secondary" onClick={() => setFresh(null)}>Done</button>
          </span>
        </div>
      )}
      {msg && <p>{msg}</p>}

      {invites.length > 0 && (
        <div style={{ overflowX: "auto", marginTop: 14 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={cell}>For</th>
                <th style={cell}>Shows</th>
                <th style={cell}>Expires</th>
                <th style={cell}>Opened</th>
                <th style={cell}>Last seen</th>
                <th style={cell}></th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id} style={{ opacity: active(i) ? 1 : 0.55 }}>
                  <td style={cell}>
                    <b>{i.label}</b>
                    <br />
                    <small>
                      {i.revoked_at ? "Turned off" : !active(i) ? "Expired" : "Active"}
                      {i.has_pin ? " · PIN" : ""}
                      {i.notify_owner ? " · email alerts" : ""}
                      {i.pin_locked_until && new Date(i.pin_locked_until) > new Date() ? " · locked (wrong PINs)" : ""}
                    </small>
                  </td>
                  <td style={cell}>
                    <small>Prototype{i.show_summary ? " + summary" : ""}{i.show_numbers ? " + numbers" : ""}</small>
                  </td>
                  <td style={cell}><small>{i.expires_at ? when(i.expires_at) : "Never"}</small></td>
                  <td style={cell}>{i.view_count} page{i.view_count === 1 ? "" : "s"}</td>
                  <td style={cell}><small>{when(i.last_viewed_at)}</small></td>
                  <td style={{ ...cell, whiteSpace: "nowrap" }}>
                    {active(i) ? (
                      <>
                        <button style={small} onClick={() => copy(linkFor(i.token), "Link")}>Copy</button>
                        <button style={small} disabled={busy === i.id} onClick={() => void setPin(i)}>PIN</button>
                        <button style={small} disabled={busy === i.id} onClick={() => void update(i, { notify_owner: !i.notify_owner }, i.notify_owner ? `No more emails when ${i.label} opens the link.` : `You'll get an email when ${i.label} opens the link.`)}>
                          {i.notify_owner ? "Alerts on" : "Alerts off"}
                        </button>
                        <button style={small} disabled={busy === i.id} onClick={() => void update(i, { show_numbers: !i.show_numbers }, i.show_numbers ? "Numbers hidden." : "Numbers shown.")}>
                          {i.show_numbers ? "Hide numbers" : "Show numbers"}
                        </button>
                        <button style={small} disabled={busy === i.id} onClick={() => void update(i, { revoked_at: new Date().toISOString() }, `Link for ${i.label} turned off. It stops working right away.`)}>
                          Turn off
                        </button>
                      </>
                    ) : (
                      <button style={small} disabled={busy === i.id} onClick={() => void update(i, { revoked_at: null, expires_at: new Date(Date.now() + 30 * 86400_000).toISOString() }, `Link for ${i.label} is on again for 30 days.`)}>
                        Turn on (30 days)
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {views.length > 0 && (
        <details style={{ marginTop: 14 }}>
          <summary>Recent views ({views.length})</summary>
          <ul>
            {views.map((v) => (
              <li key={v.id}>
                <small>
                  {when(v.created_at)} · {labelOf(v.invite_id)} · <code>{v.path}</code>
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const field = { display: "grid", gap: 4, fontWeight: 600, fontSize: ".88rem" } as const;
const input = { padding: "9px 11px", border: "1px solid #cfd7e3", borderRadius: 10, font: "inherit", fontWeight: 400 } as const;
const cell = { padding: "8px 10px", borderBottom: "1px solid #eef1f5", verticalAlign: "top" } as const;
const small = { marginRight: 6, padding: "4px 9px", border: "1px solid #cfd7e3", borderRadius: 999, background: "#fff", font: "inherit", fontSize: ".8rem", cursor: "pointer" } as const;
