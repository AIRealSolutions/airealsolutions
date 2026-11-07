// Browser helper: the Factory keeps its Supabase session in localStorage (see app/login/FactoryLogin.tsx).
// Returns a fresh access token, refreshing it with the refresh token when it has expired.
const SUPABASE_URL = "https://xqdsmbyealtammgmpsqe.supabase.co";
const SUPABASE_KEY = "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";
const SESSION_KEY = "airealsolutions.factory.session.v1";

type Session = { access_token: string; refresh_token?: string; expires_in?: number; expires_at?: number; user?: { id: string; email?: string } };

export async function factoryToken(): Promise<string | null> {
  let s: Session;
  try {
    s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
  if (!s?.access_token) return null;
  const expiresAt = s.expires_at ? (s.expires_at < 1e12 ? s.expires_at * 1000 : s.expires_at) : 0;
  if (expiresAt && expiresAt > Date.now() + 60_000) return s.access_token;
  if (!s.refresh_token) return s.access_token;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!r.ok) return s.access_token;
    const next = (await r.json()) as Session;
    const saved = { ...s, ...next, expires_at: next.expires_at || Math.floor(Date.now() / 1000) + (next.expires_in || 3600) };
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved));
    return saved.access_token;
  } catch {
    return s.access_token;
  }
}

/** Call one of our /api/integrations routes as the signed-in Factory user. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await factoryToken();
  if (!token) throw new Error("Sign in to the Factory first.");
  const r = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d as T;
}
