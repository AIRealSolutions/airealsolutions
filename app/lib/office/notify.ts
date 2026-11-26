// Phase 8: phone notifications. Web Push (RFC 8291 payload encryption + RFC 8292 VAPID) with Node's own crypto,
// and text messages through Twilio. Server-only. Nothing here sends email; the morning brief keeps using Resend.
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from "node:crypto";
import { HttpError } from "../integrations/server";
import type { Rest } from "./server";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
export const smsConfigured = () => Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
export const vapidPublicKey = () => process.env.VAPID_PUBLIC_KEY || "";

// ---- Web Push ----------------------------------------------------------------------------------------

/** aes128gcm-encrypt a payload for one browser subscription (RFC 8291, single record). */
export function encryptPayload(payload: Buffer, p256dh: string, authSecret: string) {
  const uaPublic = fromB64u(p256dh);
  const auth = fromB64u(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error("Bad subscription keys.");
  const ecdh = createECDH("prime256v1");
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, auth, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

/** A VAPID JWT for the push service at `endpoint` (RFC 8292), signed with the server's P-256 key. */
export function vapidHeader(endpoint: string) {
  const pub = fromB64u(vapidPublicKey());
  const d = process.env.VAPID_PRIVATE_KEY || "";
  if (pub.length !== 65 || fromB64u(d).length !== 32) throw new HttpError(503, "VAPID keys are missing or malformed.");
  const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: process.env.VAPID_SUBJECT || "mailto:office@airealsolutions.com",
  })));
  const sig = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${vapidPublicKey()}`;
}

export type PushMessage = { title: string; body: string; url?: string; tag?: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; failures: number };

async function pushOne(sub: Sub, msg: PushMessage): Promise<"ok" | "gone" | "error"> {
  const host = new URL(sub.endpoint).hostname;
  // Only real push services (guards against a stored endpoint pointing anywhere else).
  if (!/(^|\.)(googleapis\.com|mozilla\.com|mozaws\.net|push\.apple\.com|notify\.windows\.com)$/.test(host)) return "gone";
  const r = await fetch(sub.endpoint, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: vapidHeader(sub.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400", Urgency: "high" },
    body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(msg)), sub.p256dh, sub.auth)),
  }).catch(() => null);
  if (!r) return "error";
  if (r.status === 404 || r.status === 410) return "gone";
  return r.ok ? "ok" : "error";
}

/** Push to every subscribed device of the given roles (as the server), or to the caller's own devices (as a user). */
export async function sendPush(rest: Rest, msg: PushMessage, roles: string[] = ["owner", "assistant"]) {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  const subs = await rest<Sub[]>(`office_push_subscriptions?role=in.(${roles.join(",")})&select=id,endpoint,p256dh,auth,failures`).catch(() => [] as Sub[]);
  let sent = 0, removed = 0;
  for (const s of subs) {
    const res = await pushOne(s, msg);
    if (res === "ok") {
      sent++;
      await rest(`office_push_subscriptions?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ failures: 0, last_ok_at: new Date().toISOString() }) }).catch(() => undefined);
    } else if (res === "gone" || s.failures >= 9) {
      removed++;
      await rest(`office_push_subscriptions?id=eq.${s.id}`, { method: "DELETE" }).catch(() => undefined);
    } else {
      await rest(`office_push_subscriptions?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ failures: s.failures + 1 }) }).catch(() => undefined);
    }
  }
  return { sent, removed };
}

// ---- Text messages (Twilio) ------------------------------------------------------------------------------

export const E164 = /^\+[1-9]\d{7,14}$/;

export async function sendSms(to: string, body: string) {
  if (!smsConfigured()) throw new HttpError(503, "Text messages are not set up (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).");
  if (!E164.test(to)) throw new HttpError(400, "The phone number must look like +19105551234.");
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    cache: "no-store",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM!, Body: body.slice(0, 600) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, d?.message || `Twilio refused the text (${r.status}).`);
  return { sid: d.sid as string };
}

// ---- What the Office sends -----------------------------------------------------------------------------

export type NotifySettings = { sms_to?: string; sms_reminders?: boolean; sms_alerts?: boolean; push_brief?: boolean };

export async function notifySettings(rest: Rest): Promise<NotifySettings> {
  const rows = await rest<{ value: NotifySettings }[]>("office_settings?key=eq.notifications&select=value&limit=1").catch(() => []);
  return rows[0]?.value || {};
}

/** Push to phones, and text the owner when the settings say so for this kind of message. */
export async function notifyOffice(rest: Rest, msg: PushMessage, kind: "reminder" | "alert" | "brief") {
  const settings = await notifySettings(rest);
  if (kind === "brief" && settings.push_brief === false) return { sent: 0, texted: false };
  const push = await sendPush(rest, msg);
  let texted = false;
  const wantSms = (kind === "reminder" && settings.sms_reminders) || (kind === "alert" && settings.sms_alerts);
  if (wantSms && settings.sms_to && smsConfigured()) {
    try { await sendSms(settings.sms_to, `${msg.title}: ${msg.body}`); texted = true; } catch (e) { console.error("[office] sms failed", e); }
  }
  return { sent: push.sent, texted };
}

/** Reminders that came due in the last day and haven't pinged a phone yet. */
export async function sendDueReminders(rest: Rest) {
  if (!pushConfigured() && !smsConfigured()) return { reminders: 0 };
  const now = new Date();
  const since = new Date(now.getTime() - 36 * 3600_000).toISOString();
  const due = await rest<{ id: string; title: string; business_id: string | null }[]>(
    `office_reminders?status=eq.pending&notified_at=is.null&remind_at=lte.${encodeURIComponent(now.toISOString())}&remind_at=gte.${encodeURIComponent(since)}&select=id,title,business_id&order=remind_at.asc&limit=15`,
  ).catch(() => []);
  for (const r of due) {
    await notifyOffice(rest, { title: "Reminder", body: r.title, url: "/office/reminders", tag: `reminder-${r.id}` }, "reminder");
    await rest(`office_reminders?id=eq.${r.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notified_at: new Date().toISOString() }) }).catch(() => undefined);
  }
  return { reminders: due.length };
}
