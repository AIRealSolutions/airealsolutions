"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../office.module.css";
import { ErrorBox } from "../components";
import { api } from "../../factory/connections/session";
import { officeRest } from "../lib/client";
import { useOfficeRole } from "../useOfficeRole";

type PushStatus = { push: boolean; publicKey: string | null; sms: boolean };
type Notify = { sms_to?: string; sms_reminders?: boolean; sms_alerts?: boolean; push_brief?: boolean };
type InstallEvent = Event & { prompt: () => Promise<void> };

const keyBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64u.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const toB64u = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function saveSetting(key: string, value: unknown) {
  await officeRest("office_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

export default function SettingsBoard() {
  const role = useOfficeRole();
  const owner = role === "owner";
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [permission, setPermission] = useState<string>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [supported, setSupported] = useState(true);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  const [notify, setNotify] = useState<Notify>({});
  const [budget, setBudget] = useState("");
  const [spent, setSpent] = useState<number | null>(null);
  const [setup, setSetup] = useState<Record<string, boolean | null>>({});
  const [keys, setKeys] = useState<{ pub: string; priv: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const refreshDevice = useCallback(async () => {
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (!ok) return;
    setPermission(Notification.permission);
    const reg = await navigator.serviceWorker.getRegistration("/office");
    setSubscribed(Boolean(await reg?.pushManager.getSubscription()));
  }, []);

  useEffect(() => {
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallEvent); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    fetch("/api/office/push/status").then((r) => r.json()).then(setStatus, () => setStatus({ push: false, publicKey: null, sms: false }));
    void refreshDevice();
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, [refreshDevice]);

  useEffect(() => {
    if (!owner) return;
    officeRest<{ key: string; value: unknown }[]>("office_settings?select=key,value").then((rows) => {
      setNotify((rows.find((r) => r.key === "notifications")?.value as Notify) || {});
      const b = rows.find((r) => r.key === "ai_monthly_budget_usd")?.value;
      setBudget(b == null ? "" : String(b));
    }, () => undefined);
    officeRest<number>("rpc/office_ai_spend_this_month", { method: "POST", body: "{}" }).then((n) => setSpent(Number(n)), () => setSpent(null));
    Promise.all([
      fetch("/api/office/plan").then((r) => r.json()).then((d) => Boolean(d.aiConfigured), () => null),
      fetch("/api/office/social/status").then((r) => r.json()).then((d) => d as { youtube: boolean; meta: boolean }, () => null),
      fetch("/api/office/billing/status").then((r) => r.json()).then((d) => Boolean(d.stripe ?? d.configured ?? d.stripeConfigured), () => null),
    ]).then(([aiOn, social, stripe]) => setSetup({ ai: aiOn, youtube: social?.youtube ?? null, meta: social?.meta ?? null, stripe }));
  }, [owner]);

  async function enablePush() {
    setError(""); setMsg(""); setBusy("push");
    try {
      if (!status?.publicKey) throw new Error("Phone notifications aren't set up on the server yet (VAPID keys).");
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") throw new Error(ios && !standalone ? "On iPhone, add the Office to your Home Screen first, open it from there, then turn on notifications." : "Notifications were blocked. Allow them for this site in the browser's settings.");
      const reg = await navigator.serviceWorker.register("/office-sw.js", { scope: "/office" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.publicKey) }));
      const j = sub.toJSON();
      await api("/api/office/push/subscribe", { method: "POST", body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, device: `${navigator.platform || ""} ${/mobile/i.test(navigator.userAgent) ? "phone" : "browser"}`.trim() }) });
      setMsg("Notifications are on for this device.");
      await refreshDevice();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not turn on notifications."); }
    finally { setBusy(""); }
  }
  async function disablePush() {
    setBusy("push");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/office");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await officeRest(`office_push_subscriptions?endpoint=eq.${encodeURIComponent(sub.endpoint)}`, { method: "DELETE" }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setMsg("Notifications are off for this device.");
      await refreshDevice();
    } finally { setBusy(""); }
  }
  async function testPush() {
    setError(""); setBusy("test");
    try { await api("/api/office/push/test", { method: "POST", body: "{}" }); setMsg("Sent. It should appear in a few seconds."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send a test."); }
    finally { setBusy(""); }
  }
  async function saveNotify() {
    setError("");
    if (notify.sms_to && !/^\+[1-9]\d{7,14}$/.test(notify.sms_to)) return setError("Phone number must look like +19105551234.");
    try { await saveSetting("notifications", notify); setMsg("Notification settings saved."); } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }
  async function testSms() {
    setError(""); setBusy("sms");
    try { await saveSetting("notifications", notify); await api("/api/office/notify/sms-test", { method: "POST", body: "{}" }); setMsg(`Texted ${notify.sms_to}.`); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send a text."); }
    finally { setBusy(""); }
  }
  async function saveBudget() {
    setError("");
    const n = budget.trim() === "" ? null : Number(budget);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 100000)) return setError("Enter a dollar amount, or leave it empty for no cap.");
    try {
      if (n == null) await officeRest("office_settings?key=eq.ai_monthly_budget_usd", { method: "DELETE" });
      else await saveSetting("ai_monthly_budget_usd", n);
      setMsg(n == null ? "No monthly AI cap." : `AI work pauses once this month's estimated spend reaches $${n}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save."); }
  }
  async function makeKeys() {
    const k = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = toB64u(await crypto.subtle.exportKey("raw", k.publicKey));
    const jwk = await crypto.subtle.exportKey("jwk", k.privateKey);
    setKeys({ pub, priv: jwk.d || "" });
  }
  const yes = (v: boolean | null | undefined) => (v == null ? "…" : v ? "✓ set up" : "not set up");

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <span className="product-tag">Admin</span>
        <h1>Settings</h1>
        <p>Phone notifications{owner ? ", text messages, the AI budget" : ""} and installing the Office as an app.</p>
      </header>
      <ErrorBox message={error} />
      {msg && <div className={styles.note} role="status">{msg}</div>}

      <article className={styles.card}>
        <h2>Notifications on this device</h2>
        <p className={styles.muted}>Reminders when they come due, posts that fail, and the morning plan.</p>
        {!supported ? <p className={styles.muted}>This browser can&apos;t receive notifications.{ios ? " On iPhone, add the Office to your Home Screen (Share → Add to Home Screen), open it from there, and come back to this page." : ""}</p> : (
          <>
            <p>{subscribed ? "✓ On for this device." : permission === "denied" ? "Blocked in the browser's site settings." : "Off for this device."}</p>
            <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
              {subscribed
                ? <><button className="button button-secondary" disabled={!!busy} onClick={() => void testPush()}>{busy === "test" ? "Sending…" : "Send a test"}</button><button className={styles.linkButton} disabled={!!busy} onClick={() => void disablePush()}>Turn off</button></>
                : <button className="button button-primary" disabled={!!busy || status?.push === false} onClick={() => void enablePush()}>{busy === "push" ? "Turning on…" : "Turn on notifications"}</button>}
            </div>
            {status?.push === false && <small className={styles.muted}>Not set up on the server yet{owner ? ": see “Phone notification keys” below." : "; ask the owner."}</small>}
          </>
        )}
      </article>

      <article className={styles.card} style={{ marginTop: 16 }}>
        <h2>Install the Office</h2>
        {standalone ? <p>✓ You&apos;re using the installed app.</p> : install ? (
          <><p className={styles.muted}>Opens like an app, in its own window, with its own icon.</p><button className="button button-primary" onClick={async () => { await install.prompt(); setInstall(null); }}>Install</button></>
        ) : ios ? (
          <p className={styles.muted}>In Safari, tap Share, then <strong>Add to Home Screen</strong>. Open the Office from the new icon; on iPhone that&apos;s also what lets notifications through.</p>
        ) : (
          <p className={styles.muted}>On Android, use Chrome&apos;s menu → <strong>Install app</strong> (or Add to Home screen). On a computer, use the install icon at the right end of the address bar.</p>
        )}
      </article>

      {owner && (
        <>
          <article className={styles.card} style={{ marginTop: 16 }}>
            <h2>Text messages</h2>
            <p className={styles.muted}>Texts go to one number through Twilio. Use them for what can&apos;t wait; everything else comes as a phone notification.</p>
            <div className={styles.formGrid}>
              <label className={styles.field}>Your mobile number<input type="tel" value={notify.sms_to || ""} onChange={(e) => setNotify({ ...notify, sms_to: e.target.value.replace(/[^\d+]/g, "") })} placeholder="+19105551234" /></label>
              <div className={styles.stack} style={{ gap: 6 }}>
                <label className={styles.checkLine}><input type="checkbox" checked={!!notify.sms_reminders} onChange={(e) => setNotify({ ...notify, sms_reminders: e.target.checked })} />Text me reminders</label>
                <label className={styles.checkLine}><input type="checkbox" checked={!!notify.sms_alerts} onChange={(e) => setNotify({ ...notify, sms_alerts: e.target.checked })} />Text me when a post fails</label>
                <label className={styles.checkLine}><input type="checkbox" checked={notify.push_brief !== false} onChange={(e) => setNotify({ ...notify, push_brief: e.target.checked })} />Morning plan as a phone notification</label>
              </div>
            </div>
            <div className={styles.rowActions} style={{ justifyContent: "flex-start" }}>
              <button className="button button-primary" onClick={() => void saveNotify()}>Save</button>
              <button className="button button-secondary" disabled={!!busy || !status?.sms || !notify.sms_to} onClick={() => void testSms()}>{busy === "sms" ? "Texting…" : "Send a test text"}</button>
            </div>
            {status && !status.sms && <small className={styles.muted}>Needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in Vercel. US numbers need Twilio&apos;s A2P 10DLC registration (or a toll-free number that&apos;s verified) before texts are delivered.</small>}
          </article>

          <article className={styles.card} style={{ marginTop: 16 }}>
            <h2>AI budget</h2>
            <p className={styles.muted}>A monthly cap on estimated AI spend. When it&apos;s reached, the agents stop until next month or until you raise it; quick (non-AI) versions keep working.{spent != null ? ` This month so far: $${spent.toFixed(2)}.` : ""}</p>
            <div className={styles.formGrid}>
              <label className={styles.field}>Monthly cap (USD)<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="No cap" /></label>
              <div style={{ alignSelf: "end" }}><button className="button button-primary" onClick={() => void saveBudget()}>Save</button></div>
            </div>
          </article>

          <article className={styles.card} style={{ marginTop: 16 }}>
            <h2>Server setup</h2>
            <ul className={styles.pubList}>
              <li><span>AI agents (ANTHROPIC_API_KEY)</span><span>{yes(setup.ai)}</span></li>
              <li><span>Phone notifications (VAPID keys)</span><span>{yes(status?.push)}</span></li>
              <li><span>Text messages (Twilio)</span><span>{yes(status?.sms)}</span></li>
              <li><span>YouTube</span><span>{yes(setup.youtube)}</span></li>
              <li><span>Facebook & Instagram</span><span>{yes(setup.meta)}</span></li>
              <li><span>Stripe payments</span><span>{yes(setup.stripe)}</span></li>
            </ul>
            <details style={{ marginTop: 12 }}>
              <summary className={styles.smallLink}>Phone notification keys</summary>
              <p className={styles.muted}>Make a key pair here (it never leaves this browser), then add both values in Vercel → Settings → Environment Variables and redeploy. Keep the private key secret; changing the keys later means each device turns notifications on again.</p>
              {!keys ? <button className="button button-secondary" onClick={() => void makeKeys()}>Make keys</button> : (
                <div className={styles.stack} style={{ gap: 8 }}>
                  <label className={styles.field}>VAPID_PUBLIC_KEY<input readOnly value={keys.pub} onFocus={(e) => e.currentTarget.select()} /></label>
                  <label className={styles.field}>VAPID_PRIVATE_KEY<input readOnly value={keys.priv} onFocus={(e) => e.currentTarget.select()} /></label>
                  <small className={styles.muted}>Also set VAPID_SUBJECT to mailto: and your email.</small>
                </div>
              )}
            </details>
          </article>
        </>
      )}
    </section>
  );
}
