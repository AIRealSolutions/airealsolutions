"use client";
// Factory station: approved Product Synthesis -> Site Spec -> instant preview at /preview/<slug>.
import { useCallback, useEffect, useState } from "react";
import { factoryToken } from "../../connections/session";
import type { SiteSpec } from "../../../lib/site-spec";

const URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";

type SpecRow = { id: string; version: number; status: string; source: string; model: string | null; synthesis_version: number | null; created_at: string; content: SiteSpec };
type Submission = { id: string; form_key: string; data: Record<string, string>; created_at: string; by_member: boolean };
type Run = { model: string; credits: number; costUsd: number; fellBack: boolean };

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

export default function SiteSpecPanel({ projectSlug }: { projectSlug: string }) {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [hasSynthesis, setHasSynthesis] = useState(false);
  const [specs, setSpecs] = useState<SpecRow[]>([]);
  const [shared, setShared] = useState(false);
  const [subs, setSubs] = useState<Submission[]>([]);
  const [subCount, setSubCount] = useState(0);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"" | "ai" | "template" | "approve" | "share">("");
  const [msg, setMsg] = useState("");
  const [run, setRun] = useState<Run | null>(null);

  const load = useCallback(async () => {
    try {
      if (!(await factoryToken())) return setMsg("Sign in to build the instant preview.");
      const ps = await rest<{ id: string }[]>(`factory_projects?slug=eq.${encodeURIComponent(projectSlug)}&select=id&limit=1`);
      const pid = ps[0]?.id;
      if (!pid) return setMsg("Project not available.");
      setProjectId(pid);
      const [syn, rows, settings, latest, all] = await Promise.all([
        rest<{ version: number }[]>(`factory_product_syntheses?project_id=eq.${pid}&status=eq.approved&select=version&limit=1`),
        rest<SpecRow[]>(`factory_site_specs?project_id=eq.${pid}&select=id,version,status,source,model,synthesis_version,created_at,content&order=version.desc&limit=10`),
        rest<{ shared: boolean }[]>(`factory_preview_settings?project_id=eq.${pid}&select=shared`),
        rest<Submission[]>(`factory_preview_submissions?project_id=eq.${pid}&select=id,form_key,data,created_at,by_member&order=created_at.desc&limit=5`),
        fetch(`${URL}/rest/v1/factory_preview_submissions?project_id=eq.${pid}&select=id`, {
          method: "HEAD",
          headers: { apikey: KEY, Authorization: "Bearer " + (await factoryToken()), Prefer: "count=exact" },
        }),
      ]);
      setHasSynthesis(syn.length > 0);
      setSpecs(rows);
      setShared(Boolean(settings[0]?.shared));
      setSubs(latest);
      setSubCount(Number(all.headers.get("content-range")?.split("/")[1] || latest.length));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not load the Site Spec.");
    }
  }, [projectSlug]);

  useEffect(() => {
    fetch("/api/factory/site-spec")
      .then((r) => r.json())
      .then((d) => setAiReady(Boolean(d?.configured)))
      .catch(() => setAiReady(false));
    void load();
  }, [load]);

  async function generate(mode: "ai" | "template") {
    setBusy(mode);
    setRun(null);
    setMsg(mode === "ai" ? "The Site Agent is designing the pages, forms and demo data. This can take a minute or two…" : "Building a template Site Spec…");
    try {
      const token = await factoryToken();
      const r = await fetch("/api/factory/site-spec", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ project: projectSlug, mode }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        if (r.status === 503 && mode === "ai") {
          setAiReady(false);
          setBusy("");
          return void generate("template");
        }
        throw new Error(d?.error || "The Site Spec could not be built.");
      }
      setRun(d.run);
      setMsg(`Site Spec v${d.spec.version} drafted${mode === "template" ? " from the template" : " by the Site Agent"}. Open the preview, then approve it.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "The Site Spec could not be built.");
    } finally {
      setBusy("");
    }
  }

  async function approve(row: SpecRow) {
    if (!projectId) return;
    setBusy("approve");
    try {
      const now = new Date().toISOString();
      await rest(`factory_project_events`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ project_id: projectId, event_type: "site_spec.approved", detail: { version: row.version } }),
      }).catch(() => null);
      await rest(`factory_site_specs?project_id=eq.${projectId}&status=eq.approved&version=neq.${row.version}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "superseded" }),
      });
      await rest(`factory_site_specs?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "approved", approved_at: now }) });
      setMsg(`Site Spec v${row.version} approved. ${shared ? "Anyone with the link now sees this version." : "Turn on sharing to let others open the preview."}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not approve the Site Spec.");
    } finally {
      setBusy("");
    }
  }

  async function toggleShare() {
    if (!projectId) return;
    setBusy("share");
    try {
      await rest(`factory_preview_settings?on_conflict=project_id`, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ project_id: projectId, shared: !shared, updated_at: new Date().toISOString() }),
      });
      setShared(!shared);
      setMsg(!shared ? "Sharing is on: anyone with the link sees the approved version (no sign-in needed)." : "Sharing is off: only project members can open the preview.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not change sharing.");
    } finally {
      setBusy("");
    }
  }

  const latest = specs[0];
  const approved = specs.find((s) => s.status === "approved");
  const link = `/preview/${projectSlug}`;
  const fullLink = typeof window === "undefined" ? link : window.location.origin + link;

  return (
    <section id="site-preview" style={{ marginTop: 32, border: "1px solid #ddd", borderRadius: 18, padding: 24 }}>
      <span className="product-tag">Software Architect</span>
      <h2>Site Spec &amp; instant preview</h2>
      <p>
        Turns the approved Product Synthesis into pages, forms, data and demo rows, and draws them as a clickable prototype. Forms really save, and the dashboard page lists what was sent, so customers and investors can try it the same day.
      </p>
      {!hasSynthesis && projectId && <p><small>Approve a Product Synthesis above first. The Site Spec is built from the approved version.</small></p>}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {aiReady !== false && (
          <button className="button button-primary" onClick={() => void generate("ai")} disabled={!hasSynthesis || !!busy}>
            {busy === "ai" ? "Site Agent working…" : latest ? "Regenerate with AI" : "Generate with AI"}
          </button>
        )}
        <button className={aiReady === false ? "button button-primary" : "button button-secondary"} onClick={() => void generate("template")} disabled={!hasSynthesis || !!busy}>
          {busy === "template" ? "Building…" : "Template draft"}
        </button>
        {latest && latest.status === "draft" && (
          <button className="button button-secondary" onClick={() => void approve(latest)} disabled={!!busy}>
            {busy === "approve" ? "Saving…" : `Approve v${latest.version}`}
          </button>
        )}
        {latest && (
          <a className="button button-secondary" href={latest.status === "approved" ? link : `${link}?v=${latest.version}`} target="_blank" rel="noreferrer">
            Open preview{latest.status === "approved" ? "" : ` (draft v${latest.version})`}
          </a>
        )}
      </div>
      {aiReady === false && <p><small>The AI Site Agent is not configured on this server, so drafts come from the template.</small></p>}
      {msg && <p>{msg}</p>}
      {run && <p><small>{run.credits} credits · about ${run.costUsd.toFixed(3)} model cost · {run.model}{run.fellBack ? " (fallback model)" : ""}</small></p>}

      {approved && (
        <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: "#f6f8fb", display: "grid", gap: 8 }}>
          <strong>Share link</strong>
          <span style={{ wordBreak: "break-all" }}>
            <a href={link} target="_blank" rel="noreferrer">{fullLink}</a>
          </span>
          <span>
            <small>
              {shared ? `Shared: anyone with the link sees v${approved.version}, the approved version.` : "Members only: other people get “not available” until sharing is on."}
            </small>
          </span>
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="button button-secondary" onClick={() => void toggleShare()} disabled={!!busy}>
              {busy === "share" ? "Saving…" : shared ? "Stop sharing" : "Share with anyone who has the link"}
            </button>
            {shared && (
              <button className="button button-secondary" onClick={() => void navigator.clipboard?.writeText(fullLink).then(() => setMsg("Link copied."))}>
                Copy link
              </button>
            )}
          </span>
        </div>
      )}

      {latest && <SpecSummary row={latest} />}

      {projectId && latest && (
        <div style={{ marginTop: 20 }}>
          <h3>Form submissions ({subCount})</h3>
          {subs.length ? (
            <ul>
              {subs.map((s) => (
                <li key={s.id}>
                  <small>{new Date(s.created_at).toLocaleString()} · {s.form_key}{s.by_member ? " · by a member" : ""}</small>
                  <br />
                  {Object.values(s.data).slice(0, 3).join(" · ")}
                </li>
              ))}
            </ul>
          ) : (
            <p><small>None yet. Send a form on the preview to test it.</small></p>
          )}
        </div>
      )}
    </section>
  );
}

function SpecSummary({ row }: { row: SpecRow }) {
  const c = row.content;
  return (
    <>
      <p style={{ marginTop: 18 }}>
        <small>
          Version {row.version} · {row.source === "site_agent" ? `Site Agent (${row.model || "Claude"})` : "template"}
          {row.synthesis_version ? ` · from synthesis v${row.synthesis_version}` : ""} · {row.status}
        </small>
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14 }}>
        <article style={card}>
          <h3>Pages</h3>
          <ul>
            {c.pages?.map((p) => (
              <li key={p.route}>
                <b>{p.nav_label}</b> <code>{p.route}</code>
                <br />
                <small>{p.sections.map((s) => s.type).join(" · ")}</small>
              </li>
            ))}
          </ul>
        </article>
        <article style={card}>
          <h3>Data</h3>
          <ul>
            {c.entities?.map((e) => (
              <li key={e.key}>
                <b>{e.label}</b>
                <br />
                <small>{e.fields.map((f) => f.label).join(", ")}</small>
              </li>
            ))}
          </ul>
          <h3>Forms</h3>
          <ul>
            {c.forms?.map((f) => (
              <li key={f.key}>
                {f.title || f.key} → {f.entity}
              </li>
            ))}
          </ul>
        </article>
        <article style={card}>
          <h3>Automations</h3>
          {c.automations?.length ? (
            <ul>
              {c.automations.map((a, i) => (
                <li key={i}>
                  {a.trigger} → {a.action}
                  {a.needs_approval ? " (needs approval)" : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p>None.</p>
          )}
          <p><small>Automations are listed for the build; the instant preview does not run them yet.</small></p>
        </article>
      </div>
    </>
  );
}

const card = { border: "1px solid #e2e2e2", borderRadius: 12, padding: 16 } as const;
