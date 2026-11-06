"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../session";

/** Google sends the user back here with ?code&state; we hand them to the server with the Factory session. */
export default function GoogleCallback() {
  const [msg, setMsg] = useState("Finishing Google sign-in…");
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // React strict mode runs effects twice in dev; a code can only be used once
    ran.current = true;
    const p = new URLSearchParams(location.search);
    const error = p.get("error");
    const code = p.get("code");
    const state = p.get("state");
    history.replaceState(null, "", location.pathname); // keep the one-time code out of history
    if (error || !code || !state) {
      setFailed(true);
      setMsg(error === "access_denied" ? "Google access was not granted." : "Google sign-in did not finish.");
      return;
    }
    api<{ email: string | null }>("/api/integrations/google/exchange", { method: "POST", body: JSON.stringify({ code, state }) })
      .then((d) => {
        setMsg(`Connected ${d.email || "your Google account"}. Taking you back…`);
        setTimeout(() => location.replace("/factory/connections"), 900);
      })
      .catch((e) => {
        setFailed(true);
        setMsg(e instanceof Error ? e.message : "Could not connect Google.");
      });
  }, []);

  return (
    <section className="section">
      <p role="status">{msg}</p>
      {failed && <a className="button button-primary" href="/factory/connections">Back to Connections</a>}
    </section>
  );
}
