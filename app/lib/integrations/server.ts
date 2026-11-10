// Server-only helpers for Factory integrations. Never import from a "use client" file:
// this module reads secrets (INTEGRATIONS_ENCRYPTION_KEY, platform tokens) from the environment.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://xqdsmbyealtammgmpsqe.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_78q5LVudkA7u2hqsecLmAw_br2XlkUB";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Turn any thrown error into a JSON response with a safe message. */
export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error("[integrations]", e);
  if (e instanceof TypeError && /fetch failed/i.test(e.message)) {
    return Response.json({ error: "A connected service could not be reached. Try again in a minute." }, { status: 502 });
  }
  return Response.json({ error: e instanceof Error ? e.message : "Unexpected error." }, { status: 500 });
}

export type FactoryUser = { id: string; email: string | null; token: string };

/** Verify the caller's Supabase session from the `Authorization: Bearer <jwt>` header. */
export async function requireUser(request: Request): Promise<FactoryUser> {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "Sign in to the Factory first.");
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) throw new HttpError(401, "Your Factory session expired. Sign in again.");
  const u = await r.json();
  return { id: u.id, email: u.email ?? null, token };
}

/** PostgREST call made AS the signed-in user, so row-level security applies. */
export async function userRest<T = unknown>(user: FactoryUser, path: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${user.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new HttpError(restStatus(r.status, data?.code), data?.message || "Database request failed.");
  return data as T;
}

/** P0402 is raised by factory_agent_run_reserve when the wallet is short. */
const restStatus = (status: number, code?: string) => (status >= 500 ? 502 : code === "P0402" ? 402 : 400);

/**
 * Call an RPC as service_role, using the server-only SUPABASE_SECRET_KEY (or the legacy
 * SUPABASE_SERVICE_ROLE_KEY). Only for functions that browsers must never call, such as
 * settling an agent run's credits.
 */
export async function serviceRpc<T = unknown>(fn: string, args: object): Promise<T> {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpError(503, "SUPABASE_SECRET_KEY is not configured on the server.");
  const headers: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("ey")) headers.Authorization = `Bearer ${key}`; // legacy JWT service_role key
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(args),
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new HttpError(restStatus(r.status, data?.code), data?.message || "Database request failed.");
  return data as T;
}

export async function isAdmin(user: FactoryUser): Promise<boolean> {
  try {
    return (await userRest<boolean>(user, "rpc/factory_is_admin", { method: "POST", body: "{}" })) === true;
  } catch {
    return false;
  }
}

export async function requireAdmin(request: Request): Promise<FactoryUser> {
  const user = await requireUser(request);
  if (!(await isAdmin(user))) throw new HttpError(403, "Factory admin access required.");
  return user;
}

/** Best-effort audit log; never blocks the action that was already taken. */
export async function logIntegrationEvent(user: FactoryUser, provider: string, action: string, detail: object = {}) {
  try {
    await userRest(user, "factory_integration_events", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: user.id, provider, action, detail }),
    });
  } catch (e) {
    console.error("[integrations] audit log failed", e);
  }
}

// ---- secrets at rest -------------------------------------------------------

function masterKey(): Buffer {
  const raw = process.env.INTEGRATIONS_ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new HttpError(503, "Integrations are not configured yet (INTEGRATIONS_ENCRYPTION_KEY is missing).");
  }
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM → "v1.<iv>.<tag>.<ciphertext>" (base64url). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), body].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptJson<T>(payload: string): T {
  const [v, iv, tag, body] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !body) throw new HttpError(500, "Stored credential is unreadable.");
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const text = Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  return JSON.parse(text) as T;
}

// ---- signed OAuth state ------------------------------------------------------

export function signState(data: { uid: string; redirectUri: string }): string {
  const body = Buffer.from(
    JSON.stringify({ ...data, n: randomBytes(8).toString("hex"), exp: Date.now() + 10 * 60_000 }),
  ).toString("base64url");
  const sig = createHmac("sha256", masterKey()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string, uid: string): { redirectUri: string } {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig) throw new HttpError(400, "Invalid sign-in state.");
  const expected = createHmac("sha256", masterKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(400, "Invalid sign-in state.");
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (data.uid !== uid) throw new HttpError(403, "This Google sign-in was started by a different Factory account.");
  if (typeof data.exp !== "number" || data.exp < Date.now()) throw new HttpError(400, "Google sign-in took too long. Try again.");
  return { redirectUri: String(data.redirectUri) };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON.");
  }
}

/** Remove CR/LF so user text can never inject extra email headers. */
export const oneLine = (s: unknown, max = 300) => String(s ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
