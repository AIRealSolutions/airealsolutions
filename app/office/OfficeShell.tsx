"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./office.module.css";
import { moduleForPath, moduleRoles, OFFICE_MODULES } from "./lib/modules";
import { officeRole, SESSION_KEY, signedInEmail, type OfficeRole } from "./lib/client";
import { OfficeRoleContext } from "./useOfficeRole";
import { factoryToken } from "../factory/connections/session";

type Gate = "checking" | "ok" | "denied" | "error";
const GROUPS = ["Plan", "Run", "Money", "Factory", "Grow", "Admin"] as const;
const ROLE_LABEL: Record<OfficeRole, string> = { owner: "Owner", assistant: "Assistant", cpa: "CPA" };

/**
 * Admin gate + side navigation for every /office page.
 * The gate is for the screen only; the database's row-level security is what actually protects the data.
 */
export default function OfficeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/office";
  const [gate, setGate] = useState<Gate>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState<OfficeRole>("owner");

  useEffect(() => {
    void (async () => {
      const token = await factoryToken();
      if (!token) {
        window.location.assign(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }
      setEmail(signedInEmail());
      try {
        const r = await officeRole();
        if (!r) { setGate("denied"); return; }
        setRole(r);
        // A CPA works in the books; their home is Accounting.
        if (r === "cpa" && pathname === "/office") { window.location.replace("/office/accounting"); return; }
        setGate("ok");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not check your access.");
        setGate("error");
      }
    })();
    // Run once on first load; navigation inside the Office keeps the same shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On phones the menu is one sideways-scrolling row: bring the current section into view.
  // The service worker shows phone notifications and lets the Office install as an app.
  useEffect(() => {
    if (gate === "ok" && "serviceWorker" in navigator) navigator.serviceWorker.register("/office-sw.js", { scope: "/office" }).catch(() => undefined);
  }, [gate]);

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
            <h1>No Office access for this account</h1>
            <p>{email ? `${email} is signed in but isn't on the AI Real Solutions team.` : "This account isn't on the team."} If you were invited, sign in with the email address the invitation went to.</p>
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

  const allowed = (slug: string) => { const m = OFFICE_MODULES.find((x) => x.slug === slug); return !m || moduleRoles(m).includes(role); };
  const here = moduleForPath(pathname);
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
          {GROUPS.filter((g) => OFFICE_MODULES.some((m) => m.group === g && allowed(m.slug))).map((group) => (
            <div key={group} className={styles.navGroup}>
              <span className={styles.navGroupLabel}>{group}</span>
              {OFFICE_MODULES.filter((m) => m.group === group && allowed(m.slug)).map((m) => (
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
          {role === "owner" && <a href="/factory/dashboard">Open the Factory →</a>}
          <small>{email}{role !== "owner" && ` · ${ROLE_LABEL[role]}`}</small>
          <button type="button" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className={styles.content}>
        <OfficeRoleContext.Provider value={role}>
          {here && !moduleRoles(here).includes(role) ? (
            <section className={styles.page}>
              <header className={styles.pageHeader}><h1>{here.label}</h1><p>This part of the Office isn&apos;t open to the {ROLE_LABEL[role]} role. Ask the owner if you need it.</p></header>
            </section>
          ) : (
            <>
              {role === "cpa" && <div className={styles.readOnlyBar} role="note">Read-only CPA access: you can view and export, but not change the books.</div>}
              {children}
            </>
          )}
        </OfficeRoleContext.Provider>
      </div>
    </div>
  );
}
