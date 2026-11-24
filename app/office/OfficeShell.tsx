"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./office.module.css";
import { OFFICE_MODULES } from "./lib/modules";
import { checkAdmin, SESSION_KEY, signedInEmail } from "./lib/client";
import { factoryToken } from "../factory/connections/session";

type Gate = "checking" | "ok" | "denied" | "error";
const GROUPS = ["Plan", "Run", "Money", "Grow"] as const;

/**
 * Admin gate + side navigation for every /office page.
 * The gate is for the screen only; the database's row-level security is what actually protects the data.
 */
export default function OfficeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/office";
  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const token = await factoryToken();
      if (!token) {
        window.location.assign(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setEmail(signedInEmail());
      try {
        setGate((await checkAdmin()) ? "ok" : "denied");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not check your access.");
        setGate("error");
      }
    })();
    // Run once on first load; navigation inside the Office keeps the same shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On phones the menu is one sideways-scrolling row: bring the current section into view.
  useEffect(() => {
    if (gate === "ok") document.querySelector('[aria-label="Office sections"] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [gate, pathname]);

  function signOut() {
    localStorage.removeItem(SESSION_KEY);
    window.location.assign("/login");
  }

  if (gate !== "ok") {
    return (
      <div className={styles.gate}>
        {gate === "checking" && <p>Opening the Office…</p>}
        {gate === "denied" && (
          <>
            <h1>Office access is for administrators</h1>
            <p>{email ? `${email} is signed in but is not an AI Real Solutions administrator.` : "This account is not an administrator."}</p>
            <a className="button button-primary" href="/factory/dashboard">Go to My Factory</a>
          </>
        )}
        {gate === "error" && (
          <>
            <h1>Could not open the Office</h1>
            <p>{error}</p>
            <button className="button button-primary" onClick={() => window.location.reload()}>Try again</button>
          </>
        )}
      </div>
    );
  }

  const isActive = (slug: string) => {
    const href = slug ? `/office/${slug}` : "/office";
    return slug ? pathname === href || pathname.startsWith(`${href}/`) : pathname === "/office";
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/office">
          <span className="brand-mark">AI</span>
          <span>
            <strong>The Office</strong>
            <small>AI Real Solutions LLC</small>
          </span>
        </a>
        {/* A div, not <nav>: globals.css hides header <nav> links on small screens. */}
        <div className={styles.nav} role="navigation" aria-label="Office sections">
          {GROUPS.map((group) => (
            <div key={group} className={styles.navGroup}>
              <span className={styles.navGroupLabel}>{group}</span>
              {OFFICE_MODULES.filter((m) => m.group === group).map((m) => (
                <a
                  key={m.slug || "today"}
                  href={m.slug ? `/office/${m.slug}` : "/office"}
                  className={isActive(m.slug) ? styles.navActive : undefined}
                  aria-current={isActive(m.slug) ? "page" : undefined}
                >
                  <span>{m.label}</span>
                  {!m.ready && <small>P{m.phase}</small>}
                </a>
              ))}
            </div>
          ))}
        </div>
        <div className={styles.sideFooter}>
          <a href="/factory/dashboard">Open the Factory →</a>
          <small>{email}</small>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
