"use client";

import { useEffect, useMemo, useState } from "react";

const SUPABASE_URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY = "airealsolutions.factory.session.v1";

type DiscoveryForm = Record<string, string>;
type Session = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  user: { id: string; email?: string };
};

type Props = { form: DiscoveryForm; brief: string };

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "factory-project";
}

async function authRequest(path: string, body: unknown) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.msg || data?.message || data?.error_description || "Authentication failed.");
  return data;
}

async function fetchUser(accessToken: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error("Could not load the authenticated user.");
  return data as { id: string; email?: string };
}

async function rest(path: string, session: Session, init: RequestInit = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || data?.hint || `Factory save failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

export default function FactorySavePanel({ form, brief }: Props) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedSlug, setSavedSlug] = useState("");

  useEffect(() => {
    async function restoreSession() {
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const accessToken = hash.get("access_token");
        if (accessToken) {
          const user = await fetchUser(accessToken);
          const nextSession: Session = {
            access_token: accessToken,
            refresh_token: hash.get("refresh_token") || undefined,
            expires_in: Number(hash.get("expires_in") || 3600),
            user,
          };
          window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
          window.history.replaceState({}, "", window.location.pathname + window.location.search);
          setSession(nextSession);
          setEmail(user.email || "");
          setMessage("Signed in. You can now save this build into the Factory.");
          return;
        }
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Session;
          if (saved?.access_token && saved?.user?.id) {
            setSession(saved);
            setEmail(saved.user.email || "");
          }
        }
      } catch {
        window.localStorage.removeItem(SESSION_KEY);
      }
    }
    restoreSession();
  }, []);

  const projectName = useMemo(() => form.organization?.trim() || "New Factory Project", [form.organization]);

  async function sendCode() {
    if (!email.trim()) return setMessage("Enter your email address first.");
    setBusy(true);
    setMessage("");
    try {
      const redirect = encodeURIComponent(window.location.href.split("#")[0]);
      await authRequest(`otp?redirect_to=${redirect}`, { email: email.trim(), create_user: true });
      setSent(true);
      setMessage("Check your email. You can use the verification code if shown, or click the sign-in link and return here automatically signed in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not send sign-in email.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    if (!code.trim()) return setMessage("Enter the verification code from your email.");
    setBusy(true);
    setMessage("");
    try {
      const data = await authRequest("verify", { email: email.trim(), token: code.trim(), type: "email" });
      const nextSession = data as Session;
      if (!nextSession?.access_token || !nextSession?.user?.id) throw new Error("Supabase did not return a valid session.");
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setMessage("Signed in. You can now save this build into the Factory.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not verify code.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProject() {
    if (!session) return setMessage("Sign in before saving to the Factory.");
    setBusy(true);
    setMessage("");
    try {
      const existingOrgs = await rest("factory_organizations?select=id,name,slug&order=created_at.asc&limit=1", session);
      let organization = Array.isArray(existingOrgs) ? existingOrgs[0] : null;
      if (!organization) {
        const orgSlug = `${slugify(projectName)}-${Date.now().toString().slice(-6)}`;
        const created = await rest("factory_organizations", session, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ name: projectName, slug: orgSlug, created_by: session.user.id }),
        });
        organization = Array.isArray(created) ? created[0] : null;
      }
      if (!organization?.id) throw new Error("Could not resolve a Factory organization.");

      const isInternal = organization.slug === "ai-real-solutions";
      const projectSlug = `${slugify(projectName)}-${Date.now().toString().slice(-6)}`;
      const createdProject = await rest("factory_projects", session, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          organization_id: organization.id,
          name: projectName,
          slug: projectSlug,
          industry: form.industry || null,
          summary: form.idea || form.problem || null,
          stage: "discovery",
          progress: 18,
          infrastructure_mode: "shared",
          data_classification: form.dataSensitivity || null,
          created_by: session.user.id,
          project_type: isInternal ? "internal_venture" : "client_build",
          next_action: "Review discovery brief and generate architecture",
          automation_summary: form.automation || null,
        }),
      });
      const project = Array.isArray(createdProject) ? createdProject[0] : null;
      if (!project?.id) throw new Error("Project record was not created.");

      const sectionMap: Record<string, string> = {
        organization: "idea", industry: "idea", idea: "idea",
        problem: "discovery", currentProcess: "discovery", desiredOutcome: "discovery",
        users: "users", mustHave: "workflow", addons: "workflow", integrations: "workflow", automation: "workflow",
        triggers: "workflow", approvals: "workflow", dataSensitivity: "data",
        timeline: "scope", budget: "scope", success: "scope",
      };
      const answers = Object.entries(form)
        .filter(([, value]) => value?.trim())
        .map(([field_key, answer]) => ({ project_id: project.id, section: sectionMap[field_key] || "discovery", field_key, answer }));
      if (answers.length) await rest("factory_intake_answers", session, { method: "POST", body: JSON.stringify(answers) });

      await rest("factory_build_briefs", session, {
        method: "POST",
        body: JSON.stringify({ project_id: project.id, version: 1, content: brief, structured_brief: { ...form, factoryVersion: 1 }, created_by: session.user.id }),
      });

      setSavedSlug(project.slug);
      setMessage("Saved to the Factory. The discovery brief is now a persistent project record.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save project.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="factory-save-panel">
    <div><span className="product-tag">Factory persistence</span><h3>Turn this discovery into a real project.</h3><p>Sign in by email, then save the intake and build brief into the protected Factory workspace.</p></div>
    {!session ? <div className="factory-auth-grid">
      <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" /></label>
      {!sent ? <button className="button button-primary" type="button" disabled={busy} onClick={sendCode}>{busy ? "Sending…" : "Email Sign-In"}</button> : <>
        <label>Verification code <small>(if your email includes one)</small><input inputMode="numeric" value={code} onChange={e => setCode(e.target.value)} placeholder="6-digit code" /></label>
        <button className="button button-primary" type="button" disabled={busy} onClick={verifyCode}>{busy ? "Verifying…" : "Verify Code"}</button>
      </>}
    </div> : <div className="factory-save-actions">
      <p>Signed in as <strong>{session.user.email || email}</strong></p>
      <button className="button button-primary" type="button" disabled={busy || !!savedSlug} onClick={saveProject}>{savedSlug ? "Saved to Factory" : busy ? "Saving…" : "Save Project to Factory"}</button>
      {savedSlug && <a className="button button-secondary" href={`/factory/projects/${savedSlug}`}>Open Project Workspace</a>}
    </div>}
    {message && <p className="factory-note" role="status">{message}</p>}
  </div>;
}
