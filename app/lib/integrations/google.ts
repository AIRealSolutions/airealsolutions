// Google (Gmail + Calendar) for Factory users. Server-only.
// Each user connects their own Google account; tokens are encrypted before they reach Supabase.
import {
  type FactoryUser,
  HttpError,
  decryptJson,
  encryptJson,
  logIntegrationEvent,
  oneLine,
  userRest,
} from "./server";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

/** Default zone for events created without one: the Factory serves North Carolina first. */
export const DEFAULT_TIME_ZONE = "America/New_York";

type StoredTokens = { refresh_token: string; access_token?: string; expires_at?: number };
type Row = { account_email: string | null; scopes: string[]; token_ciphertext: string; status: string; connected_at: string };

function clientCreds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(503, "Google is not configured yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).");
  return { id, secret };
}

/** Where Google sends the user back. Must be listed in the Google Cloud OAuth client. */
export function googleRedirectUri(request: Request): string {
  return process.env.GOOGLE_REDIRECT_URI || `${new URL(request.url).origin}/factory/connections/google`;
}

export function googleAuthUrl(state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientCreds().id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token, even on reconnect
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const { id, secret } = clientCreds();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...body }),
    cache: "no-store",
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(400, d.error_description || d.error || "Google rejected the request.");
  return d as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

/** Finish the OAuth flow: swap the code for tokens and save them (encrypted) for this user. */
export async function connectGoogle(user: FactoryUser, code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new HttpError(400, "Google did not return offline access. Remove the app at myaccount.google.com/permissions and try again.");
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
    cache: "no-store",
  }).then((r) => (r.ok ? r.json() : {})) as { email?: string };
  const tokens: StoredTokens = { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  const scopes = (t.scope || "").split(" ").filter(Boolean);
  await userRest(user, "factory_user_integrations?on_conflict=user_id,provider", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      user_id: user.id,
      provider: "google",
      account_email: info.email ?? null,
      scopes,
      token_ciphertext: encryptJson(tokens),
      status: "connected",
      last_error: null,
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  await logIntegrationEvent(user, "google", "connected", { account_email: info.email ?? null, scopes });
  return { email: info.email ?? null, scopes };
}

export async function googleConnection(user: FactoryUser): Promise<Row | null> {
  const rows = await userRest<Row[]>(
    user,
    `factory_user_integrations?provider=eq.google&user_id=eq.${user.id}&select=account_email,scopes,token_ciphertext,status,connected_at&limit=1`,
  );
  return rows[0] ?? null;
}

/** A fresh access token for this user, refreshing (and re-saving) it when expired. */
async function accessToken(user: FactoryUser): Promise<string> {
  const row = await googleConnection(user);
  if (!row) throw new HttpError(409, "Connect your Google account first.");
  const tokens = decryptJson<StoredTokens>(row.token_ciphertext);
  if (tokens.access_token && (tokens.expires_at ?? 0) > Date.now() + 60_000) return tokens.access_token;
  let t;
  try {
    t = await tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" });
  } catch (e) {
    await userRest(user, `factory_user_integrations?provider=eq.google&user_id=eq.${user.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "error", last_error: e instanceof Error ? e.message : "refresh failed", updated_at: new Date().toISOString() }),
    }).catch(() => undefined);
    throw new HttpError(409, "Google access expired or was removed. Reconnect your Google account.");
  }
  const next: StoredTokens = { ...tokens, access_token: t.access_token, expires_at: Date.now() + t.expires_in * 1000 };
  await userRest(user, `factory_user_integrations?provider=eq.google&user_id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ token_ciphertext: encryptJson(next), status: "connected", last_error: null, updated_at: new Date().toISOString() }),
  });
  return t.access_token;
}

export async function disconnectGoogle(user: FactoryUser) {
  const row = await googleConnection(user);
  if (row) {
    try {
      const { refresh_token } = decryptJson<StoredTokens>(row.token_ciphertext);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh_token)}`, { method: "POST" });
    } catch {
      /* still remove our copy below */
    }
  }
  await userRest(user, `factory_user_integrations?provider=eq.google&user_id=eq.${user.id}`, { method: "DELETE" });
  await logIntegrationEvent(user, "google", "disconnected");
}

async function google<T>(user: FactoryUser, url: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(user);
  const r = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = d?.error?.message || "Google request failed.";
    throw new HttpError(r.status === 401 || r.status === 403 ? 409 : 502, msg);
  }
  return d as T;
}

// ---- Gmail -----------------------------------------------------------------

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export async function sendGmail(user: FactoryUser, input: { to: string; subject: string; text: string }) {
  const to = oneLine(input.to, 320);
  const subject = oneLine(input.subject, 250);
  const text = String(input.text ?? "").slice(0, 50_000);
  if (!EMAIL.test(to)) throw new HttpError(400, "Enter one valid recipient email address.");
  if (!subject || !text.trim()) throw new HttpError(400, "Subject and message are required.");
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(text, "utf8").toString("base64"),
  ].join("\r\n");
  const sent = await google<{ id: string; threadId: string }>(user, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
  });
  await logIntegrationEvent(user, "gmail", "sent", { to, subject, message_id: sent.id });
  return sent;
}

export type InboxMessage = { id: string; threadId: string; from: string; subject: string; date: string; snippet: string };

export async function listGmail(user: FactoryUser, q = "", max = 10): Promise<InboxMessage[]> {
  const params = new URLSearchParams({ maxResults: String(Math.min(Math.max(max, 1), 25)) });
  if (q) params.set("q", q.slice(0, 200));
  const list = await google<{ messages?: { id: string }[] }>(user, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`);
  const ids = (list.messages || []).map((m) => m.id);
  return Promise.all(
    ids.map(async (id) => {
      const m = await google<{ id: string; threadId: string; snippet: string; payload: { headers: { name: string; value: string }[] } }>(
        user,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
      );
      const h = (n: string) => m.payload.headers.find((x) => x.name.toLowerCase() === n)?.value || "";
      return { id: m.id, threadId: m.threadId, from: h("from"), subject: h("subject"), date: h("date"), snippet: m.snippet };
    }),
  );
}

// ---- Calendar --------------------------------------------------------------

export type CalendarEvent = { id: string; summary: string; start: string; end: string; htmlLink: string; location?: string };

type GEvent = { id: string; summary?: string; htmlLink: string; location?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string } };
const toEvent = (e: GEvent): CalendarEvent => ({
  id: e.id,
  summary: e.summary || "(no title)",
  start: e.start.dateTime || e.start.date || "",
  end: e.end.dateTime || e.end.date || "",
  htmlLink: e.htmlLink,
  location: e.location,
});

export async function listEvents(user: FactoryUser, max = 10): Promise<CalendarEvent[]> {
  const p = new URLSearchParams({
    timeMin: new Date().toISOString(),
    maxResults: String(Math.min(Math.max(max, 1), 50)),
    singleEvents: "true",
    orderBy: "startTime",
  });
  const d = await google<{ items?: GEvent[] }>(user, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`);
  return (d.items || []).map(toEvent);
}

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export async function createEvent(
  user: FactoryUser,
  input: { summary: string; start: string; end: string; timeZone?: string; description?: string; location?: string; attendees?: string[] },
): Promise<CalendarEvent> {
  const summary = oneLine(input.summary, 250);
  if (!summary) throw new HttpError(400, "Event title is required.");
  if (!LOCAL_DT.test(input.start) || !LOCAL_DT.test(input.end)) throw new HttpError(400, "Start and end must look like 2026-11-07T10:00.");
  if (input.end <= input.start) throw new HttpError(400, "End must be after start.");
  const timeZone = oneLine(input.timeZone || DEFAULT_TIME_ZONE, 64);
  const attendees = (input.attendees || []).map((a) => oneLine(a, 320)).filter((a) => EMAIL.test(a)).slice(0, 20);
  const p = new URLSearchParams({ sendUpdates: attendees.length ? "all" : "none" });
  const e = await google<GEvent>(user, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`, {
    method: "POST",
    body: JSON.stringify({
      summary,
      description: String(input.description ?? "").slice(0, 8000) || undefined,
      location: oneLine(input.location, 500) || undefined,
      start: { dateTime: input.start.length === 16 ? `${input.start}:00` : input.start, timeZone },
      end: { dateTime: input.end.length === 16 ? `${input.end}:00` : input.end, timeZone },
      attendees: attendees.map((email) => ({ email })),
    }),
  });
  await logIntegrationEvent(user, "calendar", "event_created", { event_id: e.id, summary, start: input.start, attendees: attendees.length });
  return toEvent(e);
}
