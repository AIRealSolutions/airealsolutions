"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../../../office.module.css";
import { api } from "../../../../factory/connections/session";

const NAME = { youtube: "YouTube", meta: "Facebook and Instagram" } as const;

function back() {
  try { const p = sessionStorage.getItem("office.studio.connect.return") || ""; if (p.startsWith("/office/")) return p; } catch { /* ignore */ }
  return "/office/studio";
}

/** Google or Facebook sends the owner back here with ?code&state; the server swaps it for tokens. */
export default function ConnectCallback({ provider }: { provider: "youtube" | "meta" }) {
  const [msg, setMsg] = useState(`Finishing the ${NAME[provider]} sign-in…`);
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // a code can only be used once (React runs effects twice in dev)
    ran.current = true;
    const p = new URLSearchParams(location.search);
    const code = p.get("code"), state = p.get("state"), error = p.get("error");
    history.replaceState(null, "", location.pathname);
    if (error || !code || !state) {
      setFailed(true);
      setMsg(error === "access_denied" ? `${NAME[provider]} access was not granted.` : `The ${NAME[provider]} sign-in did not finish.`);
      return;
    }
    try { localStorage.setItem("office.studio.tab", "channels"); } catch { /* ignore */ }
    api<{ accounts: { name: string; provider: string }[] }>(`/api/office/social/${provider}/exchange`, { method: "POST", body: JSON.stringify({ code, state }) })
      .then((d) => {
        setMsg(`Connected ${d.accounts.map((a) => a.name).join(", ") || NAME[provider]}. Taking you back…`);
        setTimeout(() => location.replace(back()), 1200);
      })
      .catch((e) => { setFailed(true); setMsg(e instanceof Error ? e.message : `Could not connect ${NAME[provider]}.`); });
  }, [provider]);

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}><span className="product-tag">Grow</span><h1>Connecting {NAME[provider]}</h1></header>
      <p role="status">{msg}</p>
      {failed && <a className="button button-primary" href={back()}>Back to the Studio</a>}
    </section>
  );
}
