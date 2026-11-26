"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { BusinessSelect } from "../components";
import { api } from "../../factory/connections/session";
import { officePatch, officeRest, prettyDate, type Business } from "../lib/client";
import { ACCOUNT_SELECT, PROVIDERS, type SocialAccount } from "./types";

type Status = { youtube: boolean; meta: boolean };

/** Connected YouTube channels, Facebook Pages and Instagram accounts, each assigned to a business. */
export default function Channels({ businesses, defaultBusiness, onMsg, onError }: { businesses: Business[]; defaultBusiness: string; onMsg: (m: string) => void; onError: (m: string) => void }) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [business, setBusiness] = useState(defaultBusiness);
  const [busy, setBusy] = useState("");
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try { setAccounts(await officeRest<SocialAccount[]>(`office_social_accounts?select=${ACCOUNT_SELECT}&order=provider.asc,name.asc`)); setMissing(false); }
    catch (e) { if (e instanceof Error && /not in the database/i.test(e.message)) setMissing(true); else onError(e instanceof Error ? e.message : "Could not load channels."); }
  }, [onError]);
  useEffect(() => { void load(); fetch("/api/office/social/status").then((r) => r.json()).then(setStatus, () => setStatus({ youtube: false, meta: false })); }, [load]);

  async function connect(kind: "youtube" | "meta") {
    setBusy(kind);
    try {
      try { sessionStorage.setItem("office.studio.connect.return", location.pathname + location.search); } catch { /* ignore */ }
      const { url } = await api<{ url: string }>(`/api/office/social/${kind}/start`, { method: "POST", body: JSON.stringify({ business_id: business || undefined }) });
      window.location.assign(url);
    } catch (e) { onError(e instanceof Error ? e.message : "Could not start the sign-in."); setBusy(""); }
  }
  async function assign(a: SocialAccount, businessId: string) {
    try { await officePatch("office_social_accounts", `id=eq.${a.id}`, { business_id: businessId || null }); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not save."); }
  }
  async function disconnect(a: SocialAccount) {
    if (!window.confirm(`Disconnect ${a.name}? Posts already sent stay where they are, and their history stays in the Studio.`)) return;
    try { await api("/api/office/social/disconnect", { method: "POST", body: JSON.stringify({ account_id: a.id }) }); onMsg(`${a.name} disconnected.`); await load(); }
    catch (e) { onError(e instanceof Error ? e.message : "Could not disconnect."); }
  }

  if (missing) return <p className={styles.muted}>Publishing isn&apos;t set up yet. Run docs/office-phase7.sql in Supabase.</p>;
  return (
    <div className={styles.stack}>
      <article className={styles.card}>
        <h2>Connect a channel</h2>
        <p className={styles.muted}>Connect each business&apos;s own channels. The Office only posts when you press Publish or schedule a piece.</p>
        <div className={styles.formGrid4}>
          <BusinessSelect businesses={businesses} value={business} onChange={setBusiness} label="For" noneLabel="Match by name" />
          <button className="button button-primary" style={{ alignSelf: "end" }} disabled={!!busy || status?.youtube === false} onClick={() => void connect("youtube")}>{busy === "youtube" ? "Opening Google…" : "▶️ Connect YouTube"}</button>
          <button className="button button-primary" style={{ alignSelf: "end" }} disabled={!!busy || status?.meta === false} onClick={() => void connect("meta")}>{busy === "meta" ? "Opening Facebook…" : "📘 Connect Facebook & Instagram"}</button>
        </div>
        {status && !status.youtube && <small className={styles.muted}>YouTube needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, the YouTube Data API turned on in Google Cloud, and <code>/office/studio/connect/youtube</code> added as a redirect URI.</small>}
        {status && !status.meta && <small className={styles.muted}>Facebook and Instagram need a Meta app: set META_APP_ID and META_APP_SECRET in Vercel and add <code>/office/studio/connect/meta</code> as a valid OAuth redirect URI.</small>}
        <small className={styles.muted}>One Facebook login brings in every Page you pick and the Instagram professional account linked to each Page.</small>
      </article>

      <article className={styles.card}>
        <h2>Connected</h2>
        {accounts.length === 0 && <p className={styles.muted}>No channels yet.</p>}
        <ul className={styles.channelList}>
          {accounts.map((a) => (
            <li key={a.id} className={styles.channelRow}>
              {a.avatar_url ? <img src={a.avatar_url} alt="" referrerPolicy="no-referrer" /> : <span className={styles.channelIcon}>{PROVIDERS[a.provider].icon}</span>}
              <div style={{ minWidth: 0 }}>
                <strong>{a.name}</strong>
                <div><small className={styles.muted}>{PROVIDERS[a.provider].label} · connected {prettyDate(a.connected_at.slice(0, 10))}</small></div>
                {a.status === "error" && <small style={{ color: "#991b1b" }}>{a.last_error || "Needs reconnecting."}</small>}
              </div>
              <div className={styles.rowActions}>
                <BusinessSelect businesses={businesses} value={a.business_id || ""} onChange={(v) => void assign(a, v)} label="Business" noneLabel="Not assigned" />
                <button type="button" className={styles.linkButton} onClick={() => void disconnect(a)}>Disconnect</button>
              </div>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
