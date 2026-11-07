"use client";
import { useEffect, useState } from "react";
import { api } from "../../connections/session";
import styles from "./delivery.module.css";

type Dns = { type: string; host: string; value: string; note?: string };
type Infra = {
  github_repo: string | null; github_url: string | null;
  vercel_project_name: string | null; vercel_url: string | null;
  supabase_ref: string | null; supabase_url: string | null; supabase_status: string | null;
  env_linked_at: string | null;
  last_deployment_url: string | null; last_deployment_state: string | null;
  domain: string | null; domain_verified: boolean | null; domain_records: Dns[];
  last_error: string | null;
};
type Configured = { github: boolean; vercel: boolean; supabase: boolean; encryption: boolean; template: string | null };
type State = { infra: Infra | null; configured: Configured };

/** Admin-only: give this project its own GitHub repo, Supabase database, Vercel site and domain. Hidden for everyone else. */
export default function DeliveryPanel({ projectSlug }: { projectSlug: string }) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [domain, setDomain] = useState("");

  useEffect(() => {
    api<State>(`/api/factory/provision?project=${encodeURIComponent(projectSlug)}`)
      .then((d) => { setState(d); setDomain(d.infra?.domain || ""); })
      .catch(() => setState(null)); // not an admin (or not signed in): show nothing
  }, [projectSlug]);

  if (!state) return null;
  const i = state.infra;
  const c = state.configured;

  async function run(action: string, extra: object = {}) {
    setBusy(action);
    setMsg("");
    try {
      const d = await api<State>("/api/factory/provision", { method: "POST", body: JSON.stringify({ project: projectSlug, action, ...extra }) });
      setState(d);
      setMsg(action === "refresh" ? "Status refreshed." : "Done.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Step failed.");
      api<State>(`/api/factory/provision?project=${encodeURIComponent(projectSlug)}`).then(setState).catch(() => undefined);
    } finally {
      setBusy("");
    }
  }
  function createDb() {
    if (!confirm("Create a new Supabase project for this customer?\n\nThis may add a monthly charge to your Supabase organization (compute is billed per project on paid plans).")) return;
    void run("supabase", { confirmCost: true });
  }

  const deployOk = i?.last_deployment_state === "READY";
  const steps = [
    {
      n: "01", title: "GitHub repository", need: c.github ? null : "GITHUB_TOKEN",
      done: Boolean(i?.github_repo),
      info: i?.github_repo ? <a href={i.github_url || "#"} target="_blank" rel="noreferrer">{i.github_repo}</a> : c.template ? `Starts from template ${c.template}` : "Private repo with a starter README",
      action: !i?.github_repo && <button className="button button-primary" disabled={!!busy || !c.github} onClick={() => void run("github")}>Create repository</button>,
    },
    {
      n: "02", title: "Supabase database", need: c.supabase ? (c.encryption ? null : "INTEGRATIONS_ENCRYPTION_KEY") : "SUPABASE_ACCESS_TOKEN",
      done: i?.supabase_status === "ACTIVE_HEALTHY",
      info: i?.supabase_ref ? <><a href={`https://supabase.com/dashboard/project/${i.supabase_ref}`} target="_blank" rel="noreferrer">{i.supabase_ref}</a> · {(i.supabase_status || "").replaceAll("_", " ").toLowerCase()}</> : "Its own database, Americas region",
      action: !i?.supabase_ref && <button className="button button-primary" disabled={!!busy || !c.supabase || !c.encryption} onClick={createDb}>Create database</button>,
    },
    {
      n: "03", title: "Vercel project", need: c.vercel ? null : "VERCEL_TOKEN",
      done: Boolean(i?.vercel_project_name),
      info: i?.vercel_project_name ? <a href={i.vercel_url || "#"} target="_blank" rel="noreferrer">{i.vercel_project_name}</a> : "Hosting linked to the repo, so every push deploys",
      action: !i?.vercel_project_name && <button className="button button-primary" disabled={!!busy || !c.vercel || !i?.github_repo} onClick={() => void run("vercel")}>Create Vercel project</button>,
    },
    {
      n: "04", title: "Connect database to site", need: null,
      done: Boolean(i?.env_linked_at),
      info: i?.env_linked_at ? `Supabase keys saved in Vercel ${new Date(i.env_linked_at).toLocaleString()}` : "Copies the database address and keys into Vercel settings",
      action: <button className={`button ${i?.env_linked_at ? "button-secondary" : "button-primary"}`} disabled={!!busy || !i?.supabase_ref || !i?.vercel_project_name} onClick={() => void run("link")}>{i?.env_linked_at ? "Re-link" : "Link"}</button>,
    },
    {
      n: "05", title: "Deploy", need: null,
      done: deployOk,
      info: i?.last_deployment_url ? <><a href={i.last_deployment_url} target="_blank" rel="noreferrer">Latest deployment</a> · {(i.last_deployment_state || "").toLowerCase()}</> : "Builds the main branch to production",
      action: <button className={`button ${deployOk ? "button-secondary" : "button-primary"}`} disabled={!!busy || !i?.vercel_project_name} onClick={() => void run("deploy")}>{i?.last_deployment_url ? "Deploy again" : "Deploy now"}</button>,
    },
  ];

  return (
    <section id="delivery" className={styles.panel}>
      <div className={styles.head}>
        <div>
          <span className="product-tag">Admin · Graduation</span>
          <h2>Own infrastructure</h2>
          <p>Move this product onto its own GitHub repository, Supabase database, Vercel hosting and domain. Each step can be run again safely.</p>
        </div>
        <button className="button button-secondary" disabled={!!busy || !i} onClick={() => void run("refresh")}>{busy === "refresh" ? "Checking…" : "Refresh status"}</button>
      </div>
      {msg && <p className={styles.msg} role="status">{msg}</p>}
      {i?.last_error && !msg && <p className={styles.error}>Last problem: {i.last_error}</p>}

      <ol className={styles.steps}>
        {steps.map((s) => (
          <li key={s.n} className={s.done ? styles.done : ""}>
            <b>{s.done ? "✓" : s.n}</b>
            <div>
              <strong>{s.title}</strong>
              <small>{s.info}</small>
              {s.need && <small className={styles.need}>Needs {s.need} in Vercel settings</small>}
            </div>
            <span>{s.action}</span>
          </li>
        ))}
      </ol>

      <div className={styles.domain}>
        <strong>06 · Custom domain</strong>
        <form onSubmit={(e) => { e.preventDefault(); void run("domain", { domain }); }}>
          <input placeholder="example.com or app.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
          <button className="button button-primary" disabled={!!busy || !i?.vercel_project_name || !domain}>{i?.domain ? "Update" : "Add domain"}</button>
        </form>
        {i?.domain && (
          <>
            <p className={styles.small}>
              {i.domain_verified ? <>✓ <strong>{i.domain}</strong> is live on Vercel.</> : <>Add these records at your DNS provider (GoDaddy: My Products → Domains → <strong>{i.domain.split(".").slice(-2).join(".")}</strong> → DNS → Add New Record), then press Refresh status. Changes usually show up within an hour.</>}
            </p>
            {!i.domain_verified && (
              <div className={styles.tableWrap}>
                <table>
                  <thead><tr><th>Type</th><th>Name / Host</th><th>Value</th><th></th></tr></thead>
                  <tbody>{i.domain_records.map((r, k) => <tr key={k}><td data-label="Type">{r.type}</td><td data-label="Name / Host"><code>{r.host}</code></td><td data-label="Value"><code>{r.value}</code></td><td data-label="">{r.note}</td></tr>)}</tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
